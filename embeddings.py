import re
import threading
import time
from collections import deque

from google import genai
from google.genai import types

from config import GEMINI_API_KEY, EMBEDDING_MODEL

client = genai.Client(api_key=GEMINI_API_KEY)

# Google's free plan allows about 100 embedded pieces per minute.
# We stay a little below that so we are not rejected.
MAX_PER_WINDOW = 90
WINDOW_SECONDS = 60
BATCH_SIZE = 30
MAX_ATTEMPTS = 4

_lock = threading.Lock()
_recent = deque()  # (time, number of pieces) for the last minute


class RateLimited(Exception):
    """Raised when Google's free embedding quota is used up."""


def _wait_for_quota(count):
    """Wait until sending `count` more pieces keeps us under the limit."""
    while True:
        with _lock:
            now = time.monotonic()
            while _recent and now - _recent[0][0] >= WINDOW_SECONDS:
                _recent.popleft()

            used = sum(amount for _, amount in _recent)
            if used + count <= MAX_PER_WINDOW:
                _recent.append((now, count))
                return

            wait = WINDOW_SECONDS - (now - _recent[0][0]) + 0.5

        time.sleep(max(wait, 1))


def _retry_delay(error, attempt):
    """How long to wait before trying again."""
    match = re.search(r"retry in ([0-9.]+)s", str(error))
    if match:
        return min(float(match.group(1)) + 2, 65)
    return min(15 * attempt, 60)


def _embed(texts, task_type):
    """Ask Gemini to embed a list of texts, with careful retries."""
    last_error = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        _wait_for_quota(len(texts))
        try:
            result = client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=texts,
                config=types.EmbedContentConfig(task_type=task_type),
            )
            return [item.values for item in result.embeddings]
        except Exception as error:
            last_error = error
            code = getattr(error, "code", None)
            print(
                f"Embedding attempt {attempt}/{MAX_ATTEMPTS} failed: "
                f"{type(error).__name__}: {str(error)[:300]}",
                flush=True,
            )

            # Only busy/limit errors are worth retrying.
            if code not in (429, 500, 503):
                raise

            if attempt < MAX_ATTEMPTS:
                time.sleep(_retry_delay(error, attempt))

    if getattr(last_error, "code", None) == 429:
        raise RateLimited("Google's free embedding quota is used up.") from last_error
    raise last_error


def embed_documents(texts):
    """Embed many code pieces, in small paced batches."""
    total = len(texts)
    vectors = []

    for start in range(0, total, BATCH_SIZE):
        batch = texts[start:start + BATCH_SIZE]
        print(
            f"Embedding pieces {start + 1}-{start + len(batch)} of {total} ...",
            flush=True,
        )
        vectors.extend(_embed(batch, "RETRIEVAL_DOCUMENT"))

    return vectors


def embed_query(question):
    """Embed one question."""
    return _embed([question], "RETRIEVAL_QUERY")[0]