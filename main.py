import os
import traceback

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from embeddings import RateLimited
from ingest import ingest_repo
from qa import answer_question, AnswerUnavailable
from vector_store import get_collection, query_collection

app = FastAPI(title="CodeRAG")

# Websites that are allowed to talk to this backend.
# Later we add the live website address through the ALLOWED_ORIGINS setting.
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

QUOTA_MESSAGE = (
    "Google's free AI quota is busy right now. "
    "Please wait a minute and try again."
)


class IngestRequest(BaseModel):
    repo_url: str


class AskRequest(BaseModel):
    repo_name: str
    question: str


@app.get("/")
def home():
    return {"status": "CodeRAG backend is running"}


@app.post("/ingest")
def ingest(request: IngestRequest):
    try:
        return ingest_repo(request.repo_url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RateLimited:
        raise HTTPException(status_code=429, detail=QUOTA_MESSAGE)
    except requests.RequestException as error:
        # the real reason is printed in the backend terminal
        print(f"GitHub download failed: {error!r}", flush=True)
        raise HTTPException(
            status_code=502,
            detail="Could not download the repository from GitHub. Please try again.",
        )
    except Exception:
        # any other problem (for example while embedding the code)
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while reading the repository. Please try again.",
        )


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