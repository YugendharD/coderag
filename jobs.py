import threading
import time
import traceback
import uuid

import requests

from embeddings import DailyQuotaExceeded, RateLimited
from ingest import ingest_repo, parse_repo_url

QUOTA_MESSAGE = (
    "Google's free AI quota is busy right now. "
    "Please wait a minute and try again."
)
DAILY_MESSAGE = (
    "Google's free daily AI quota for this site looks used up. "
    "It usually resets once a day, so please try again later."
)
BUSY_MESSAGE = (
    "Another repository is being indexed right now. "
    "Please wait a minute and try again."
)

MODES = ("quick", "full")

STALE_AFTER_SECONDS = 15 * 60   # a job running longer than this is forgotten
MAX_JOBS_KEPT = 50

# Jobs live in memory. If the server restarts, running jobs are lost.
_jobs = {}
_lock = threading.Lock()
_active_job_id = None  # only one repository is indexed at a time


class Busy(Exception):
    """Raised when a different repository is already being indexed."""


def _public(job):
    """The part of a job that the website may see."""
    return {key: value for key, value in job.items() if not key.startswith("_")}


def _update(job_id, **fields):
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)


def _fail(job_id, message):
    _update(job_id, status="error", stage="Failed", error=message)


def start_job(repo_url, mode="quick"):
    """Start indexing in the background and return the job right away."""
    global _active_job_id

    if mode not in MODES:
        raise ValueError("Unknown indexing mode.")

    # raises ValueError for a link that is not a GitHub repository
    owner, repo = parse_repo_url(repo_url)
    key = f"{owner}/{repo}/{mode}".lower()

    with _lock:
        if _active_job_id is not None:
            active = _jobs.get(_active_job_id)
            if active is None:
                _active_job_id = None
            elif time.time() - active["_started"] > STALE_AFTER_SECONDS:
                _active_job_id = None  # a stuck job: forget it
            elif active["_key"] == key:
                return _public(active)  # the same job is already running
            else:
                raise Busy()

        job_id = uuid.uuid4().hex[:12]
        job = {
            "job_id": job_id,
            "status": "running",
            "stage": "Starting",
            "done": 0,
            "total": 0,
            "repo_name": f"{owner}_{repo}",
            "result": None,
            "error": None,
            "_key": key,
            "_started": time.time(),
        }
        _jobs[job_id] = job
        _active_job_id = job_id

        # forget the oldest jobs so memory does not grow forever
        if len(_jobs) > MAX_JOBS_KEPT:
            for old_id in list(_jobs)[: len(_jobs) - MAX_JOBS_KEPT]:
                if old_id != _active_job_id:
                    _jobs.pop(old_id, None)

        snapshot = _public(job)

    thread = threading.Thread(target=_run, args=(job_id, repo_url, mode), daemon=True)
    thread.start()
    return snapshot


def get_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
        return _public(job) if job else None


def _run(job_id, repo_url, mode):
    """The background work. Runs in its own thread."""
    global _active_job_id

    def progress(stage, done=None, total=None):
        fields = {"stage": stage}
        if done is not None:
            fields["done"] = done
        if total is not None:
            fields["total"] = total
        _update(job_id, **fields)

    try:
        result = ingest_repo(repo_url, progress, mode)
        _update(job_id, status="done", stage="Done", result=result, error=None)
    except ValueError as error:
        _fail(job_id, str(error))
    except DailyQuotaExceeded:
        _fail(job_id, DAILY_MESSAGE)
    except RateLimited:
        _fail(job_id, QUOTA_MESSAGE)
    except requests.RequestException as error:
        print(f"GitHub download failed: {error!r}", flush=True)
        _fail(
            job_id,
            "Could not download the repository from GitHub. Please try again.",
        )
    except Exception:
        traceback.print_exc()
        _fail(
            job_id,
            "Something went wrong while reading the repository. Please try again.",
        )
    finally:
        with _lock:
            if _active_job_id == job_id:
                _active_job_id = None