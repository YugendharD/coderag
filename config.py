import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing. Check your .env file.")

# Model that turns text into numbers (embeddings)
EMBEDDING_MODEL = "gemini-embedding-001"

# Models that write answers. The first is tried first;
# the others are backups if the first one is busy.
ANSWER_MODELS = [
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
]