import re
import threading
import time
from collections import deque

from google import genai
from google.genai import types

from config import GEMINI_API_KEY, EMBEDDING_MODEL

client = genai.Client(api_key=GEMINI_API_KEY)

# Google's free plan limits both the NUMBER of pieces and the AMOUNT of
# text per minute. We stay clearly below both.
MAX_ITEMS_PER_MINUTE = 60
MAX_TOKENS_PER_MINUTE = 22_000   # rough estimate: 1 token = 4 characters
WINDOW_SECONDS = 60
BATCH_SIZE = 10
MAX_ATTEMPTS = 4

_lock = threading.Lock()
_recent = deque()  # (time, number of pieces, estimated tokens)


class RateLimited(Exception):
    """Raised when Google's free embedding quota is used up for now."""


class DailyQuotaExceeded(RateLimited):
    """Raised when the daily free quota looks used up."""


def _estimate_tokens(texts):
    return sum(len(text) for text in texts) // 4 + 1


def _wait_for_quota(items, tokens):
    """Wait until sending this batch keeps us under the per-minute limits."""
    while True:
        with _lock:
            now = time.monotonic()
            while _recent and now - _recent[0][0] >= WINDOW_SECONDS:
                _recent.popleft()

            used_items = sum(entry[1] for entry in _recent)
            used_tokens = sum(entry[2] for entry in _recent)

            fits = (
                used_items + items <= MAX_ITEMS_PER_MINUTE
                and used_tokens + tokens <= MAX_TOKENS_PER_MINUTE
            )
            if fits or not _recent:
                _recent.append((now, items, tokens))
                return

            wait = WINDOW_SECONDS - (now - _recent[0][0]) + 0.5

        time.sleep(max(wait, 1))


def _retry_delay(error, attempt):
    """How long to wait before trying again."""
    text = str(error)
    match = re.search(r"retry in ([0-9.]+)s", text) or re.search(
        r"retryDelay'?: '([0-9.]+)s", text
    )
    if match:
        return min(float(match.group(1)) + 2, 65)
    return min(20 * attempt, 65)


def _looks_like_daily_limit(error):
    text = str(error).lower()
    return "perday" in text or "per day" in text


def _embed(texts, task_type):
    """Ask Gemini to embed a list of texts, with careful retries."""
    last_error = None
    tokens = _estimate_tokens(texts)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        _wait_for_quota(len(texts), tokens)
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
                f"Embedding attempt {attempt}/{MAX_ATTEMPTS} failed "
                f"({len(texts)} pieces, about {tokens} tokens): "
                f"{type(error).__name__}: {str(error)[:1200]}",
                flush=True,
            )

            # Only busy/limit errors are worth retrying.
            if code not in (429, 500, 503):
                raise

            if code == 429 and _looks_like_daily_limit(error):
                raise DailyQuotaExceeded(
                    "The daily free quota looks used up."
                ) from error

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