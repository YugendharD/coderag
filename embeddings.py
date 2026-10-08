import time

from google import genai
from google.genai import types

from config import GEMINI_API_KEY, EMBEDDING_MODEL

client = genai.Client(api_key=GEMINI_API_KEY)


def _embed(texts, task_type):
    """Ask Gemini to embed a list of texts. Retries if Google is busy."""
    last_error = None

    for attempt in range(4):
        try:
            result = client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=texts,
                config=types.EmbedContentConfig(task_type=task_type),
            )
            return [item.values for item in result.embeddings]
        except Exception as error:
            last_error = error
            time.sleep(2 * (attempt + 1))  # wait 2s, 4s, 6s, then give up

    raise last_error


def embed_documents(texts, batch_size=50):
    """Embed many code pieces (sent in small batches)."""
    vectors = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        vectors.extend(_embed(batch, "RETRIEVAL_DOCUMENT"))
    return vectors


def embed_query(question):
    """Embed one question."""
    return _embed([question], "RETRIEVAL_QUERY")[0]