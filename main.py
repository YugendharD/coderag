import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from embeddings import DailyQuotaExceeded, RateLimited
from jobs import (
    BUSY_MESSAGE,
    DAILY_MESSAGE,
    QUOTA_MESSAGE,
    Busy,
    get_job,
    start_job,
)
from qa import answer_question, AnswerUnavailable
from vector_store import get_collection, query_collection

app = FastAPI(title="CodeRAG")

# Websites that are allowed to talk to this backend.
# The live website address is added through the ALLOWED_ORIGINS setting.
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
extra_origins = os.getenv("ALLOWED_ORIGINS", "")
origins += [o.strip() for o in extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IngestRequest(BaseModel):
    repo_url: str
    mode: str = "quick"   # "quick" (fast) or "full" (more pieces, slower)


class AskRequest(BaseModel):
    repo_name: str
    question: str


@app.get("/")
def home():
    return {"status": "CodeRAG backend is running"}


@app.post("/ingest")
def ingest(request: IngestRequest):
    """Start indexing in the background. Returns a job to check on."""
    try:
        return start_job(request.repo_url, request.mode)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Busy:
        raise HTTPException(status_code=429, detail=BUSY_MESSAGE)


@app.get("/ingest/{job_id}")
def ingest_status(job_id: str):
    """How far along is this indexing job?"""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "I lost track of this indexing job (the server may have "
                "restarted). Please load the repository again."
            ),
        )
    return job


@app.post("/ask")
def ask(request: AskRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Please type a question.")

    collection = get_collection(request.repo_name)
    if collection is None or collection.count() == 0:
        raise HTTPException(
            status_code=400,
            detail="This repository hasn't been ingested yet.",
        )

    try:
        results = query_collection(collection, request.question)
    except DailyQuotaExceeded:
        raise HTTPException(status_code=429, detail=DAILY_MESSAGE)
    except RateLimited:
        raise HTTPException(status_code=429, detail=QUOTA_MESSAGE)

    try:
        answer = answer_question(request.question, results)
    except AnswerUnavailable:
        raise HTTPException(
            status_code=503,
            detail="The AI is very busy right now. Please try again in a minute.",
        )

    sources = sorted({meta["path"] for meta in results["metadatas"][0]})

    return {"answer": answer, "sources": sources}