# CodeRAG

**Chat with any public GitHub repository.** Paste a repo link, let CodeRAG read it, then ask questions about the code in plain English. Every answer lists the files it was based on.

- **Live website:** https://coderag-teal.vercel.app
- **Backend API docs:** https://coderag-5it1.onrender.com/docs

> The backend runs on a free plan and goes to sleep when nobody uses it, so the first request after a pause can take about a minute.

---

## What it does

1. You paste a link such as `https://github.com/owner/repo`.
2. The backend downloads the repository, picks the useful code and text files, and cuts them into pieces.
3. Each piece is turned into numbers (an *embedding*) with Google Gemini and stored in a vector database (ChromaDB).
4. You ask a question. CodeRAG finds the pieces that match best and asks Gemini to answer **using only those pieces**.
5. You get the answer plus the list of files that were used.

This approach is called **RAG** (Retrieval-Augmented Generation).

## Features

- Works with any **public** GitHub repository.
- **Background indexing with a live progress bar** ("Indexed 30 of 80 pieces").
- **Quick index** (fast, about 45 pieces) and an **"Index more"** button for a fuller index (about 80 pieces).
- A notice when a large repository was only partly indexed.
- Answers with **source files** and a one-click **Copy** button.
- Clickable **example repositories** and **example questions**.
- If the server forgets a repository (for example after a restart), the website **re-indexes it automatically**.
- Friendly error messages when Google's free quota is busy.
- A cinematic **galaxy and constellation** interface built with three.js, including an opening title sequence.
- A **pipeline panel** that lights up step by step: Download, Read files, Embed, Store, Answer.

## How it works

```
GitHub link
   -> download the repository as a zip
   -> keep useful files (code, docs, config), skip big or generated ones
   -> cut into pieces (2500 characters, 200 overlap)
   -> embed the pieces with Gemini (gemini-embedding-001)
   -> store them in ChromaDB (one collection per repository)

Question
   -> embed the question
   -> find the 6 closest pieces in that repository's collection
   -> ask Gemini to answer using only those pieces
   -> return the answer + the source files
```

Each repository has its **own collection** in the database, so a question about one repository never searches another one.

## Tech stack

| Part | Technology |
|---|---|
| Backend | Python, FastAPI, Uvicorn |
| Embeddings and answers | Google Gemini (`google-genai`) |
| Vector database | ChromaDB (saved in a local `chroma_db` folder) |
| Frontend | React, Vite, react-markdown |
| 3D background | three.js |
| Hosting | Render (backend), Vercel (frontend) |

## Project structure

```
.
├── main.py              # FastAPI app and API endpoints
├── jobs.py              # background indexing jobs and their progress
├── ingest.py            # download, filter and cut up a repository
├── chunker.py           # splits text into overlapping pieces
├── embeddings.py        # Gemini embeddings with pacing and retries
├── vector_store.py      # ChromaDB: save and search pieces
├── qa.py                # builds the prompt and asks Gemini
├── config.py            # reads the API key and model names
├── check_key.py         # lists the Gemini models your key can use
├── requirements.txt     # Python packages
├── test_*.py            # small manual test scripts
└── frontend/
    ├── package.json
    └── src/
        ├── App.jsx              # the whole interface
        ├── ThreeBackground.jsx  # galaxy, constellations, opening title
        ├── App.css              # layout and chat styling
        ├── Constellation.css    # glass panels, film look, intro
        ├── Progress.css         # progress bar and notices
        ├── index.css            # page background
        └── main.jsx
```

## Run it on your computer

### What you need

- **Python 3.13 or newer**
- **Node.js** (a recent LTS version)
- A free **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)

### 1. Get the code

```bash
git clone https://github.com/YugendharD/coderag.git
cd coderag
```

### 2. Start the backend

Windows (PowerShell):

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

macOS or Linux:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a file named `.env` in the project folder with your key:

```
GEMINI_API_KEY=paste_your_key_here
```

Then start the server:

```bash
uvicorn main:app
```

The API is now at http://127.0.0.1:8000 (interactive docs at http://127.0.0.1:8000/docs).

### 3. Start the website

Open a **second terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Configuration

| Setting | Where | What it does |
|---|---|---|
| `GEMINI_API_KEY` | backend `.env` file | Your Google Gemini key (required). Never commit this file. |
| `ALLOWED_ORIGINS` | backend environment | Website addresses allowed to call the API, separated by commas. `localhost:5173` is always allowed. |
| `VITE_API_URL` | frontend environment | Address of the backend. Defaults to `http://127.0.0.1:8000`. |

The Gemini model names are set in `config.py` (`EMBEDDING_MODEL` and `ANSWER_MODELS`). Run `python check_key.py` to see which models your key can use.

## API

| Method and path | What it does |
|---|---|
| `GET /` | Health check. |
| `POST /ingest` | Starts indexing a repository in the background. Body: `{"repo_url": "https://github.com/owner/repo", "mode": "quick"}`. `mode` is `quick` or `full`. Returns a job. |
| `GET /ingest/{job_id}` | Progress of an indexing job: `status`, `stage`, `done`, `total`, and the `result` when finished. |
| `POST /ask` | Asks a question. Body: `{"repo_name": "owner_repo", "question": "..."}`. Returns `{"answer": "...", "sources": ["path/to/file"]}`. |

## Deployment

**Backend on Render (web service):**

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Environment variables: `GEMINI_API_KEY` and `ALLOWED_ORIGINS` (your website address)

**Frontend on Vercel:**

- Framework: Vite, Root Directory: `frontend`
- Environment variable: `VITE_API_URL` set to your backend address (no slash at the end)

On Render's free plan the disk is wiped when the service sleeps or restarts, so indexed repositories are forgotten. The website notices this and indexes the repository again automatically.

## Limits and known issues

This is a learning project, so it is honest about what it does not do yet:

- **Public repositories only.**
- **Large repositories are only partly indexed.** A quick index covers about 45 pieces, a full one about 80. Files over 60 KB are skipped, and `tests`, `docs` and `examples` folders are skipped too.
- **Google's free embedding quota is small.** Indexing is paced to stay under it, so a full index takes about two minutes. If the quota is used up you see a friendly message and can try again later.
- **One repository is indexed at a time.**
- **No conversation memory.** Each question is answered on its own.
- **Answers cite files, not line numbers.**
- Pieces are cut by length, not by code structure (functions and classes).
- Indexing jobs are kept in the server's memory, so a restart cancels a job that is running.
- No user accounts and no rate limiting.

## Roadmap

- Answers that cite exact line numbers and say "not enough evidence" when the code does not contain the answer.
- Structure-aware chunking (functions, classes) and keyword + vector search with reranking.
- Conversation memory that stays inside the selected repository.
- Persistent storage and a repository list.
- Automated tests and an evaluation set for answer quality.

## Security

- Your API key lives only in the `.env` file or in the host's environment settings. `.env` is listed in `.gitignore` and must never be committed.
- Repository content is treated as data. Do not index repositories you do not trust with a key that has billing enabled.

## Author

Built by Yugendhar Dommaraju ([@YugendharD](https://github.com/YugendharD)).