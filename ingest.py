import io
import zipfile

import requests

from chunker import chunk_text
from vector_store import save_chunks

ALLOWED_EXTENSIONS = (
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rs",
    ".c", ".cpp", ".h", ".cs", ".rb", ".php", ".html", ".css",
    ".md", ".txt", ".yml", ".yaml", ".toml",
)

# Files without an extension that are still worth reading
ALLOWED_NAMES = {"package.json", "README", "Dockerfile", "Makefile"}

# Folders we skip so that loading stays fast
SKIP_FOLDERS = {
    "node_modules", ".git", "dist", "build", "venv", "__pycache__",
    ".next", "coverage", ".vscode", ".idea", "vendor", "third_party",
    "tests", "test", "__tests__", "docs", "examples",
}

SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}

# Limits that keep loading quick. Google's free plan embeds about 90
# pieces per minute, so 150 pieces take roughly 2 minutes.
MAX_FILE_BYTES = 60_000   # skip big files
MAX_FILES = 80            # read at most this many files
MAX_CHUNKS = 150          # create at most this many pieces
CHUNK_SIZE = 2500         # bigger pieces = fewer pieces = faster
CHUNK_OVERLAP = 200


def parse_repo_url(repo_url):
    """Turn https://github.com/owner/repo into ('owner', 'repo')."""
    url = repo_url.strip().rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]

    parts = url.split("github.com/")
    if len(parts) != 2:
        raise ValueError("Please give a link like https://github.com/owner/repo")

    pieces = parts[1].split("/")
    if len(pieces) < 2 or not pieces[0] or not pieces[1]:
        raise ValueError("Please give a link like https://github.com/owner/repo")

    return pieces[0], pieces[1]


def download_repo_zip(owner, repo):
    url = f"https://codeload.github.com/{owner}/{repo}/zip/HEAD"
    response = requests.get(url, timeout=60)

    if response.status_code == 404:
        raise ValueError("Repository not found. Is the link right and the repo public?")

    response.raise_for_status()
    return response.content


def should_read(path, size):
    parts = path.split("/")

    for folder in parts[:-1]:
        if folder in SKIP_FOLDERS:
            return False

    name = parts[-1]
    if name in SKIP_FILES:
        return False
    if ".min." in name.lower():
        return False

    allowed = name in ALLOWED_NAMES or name.lower().endswith(ALLOWED_EXTENSIONS)
    if not allowed:
        return False

    return size <= MAX_FILE_BYTES


def ingest_repo(repo_url):
    owner, repo = parse_repo_url(repo_url)
    repo_name = f"{owner}_{repo}"

    print(f"Downloading {owner}/{repo} ...", flush=True)
    zip_bytes = download_repo_zip(owner, repo)

    chunks = []
    paths = []
    files_read = 0
    truncated = False

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        # collect the files we are allowed to read
        candidates = []
        for info in zf.infolist():
            if info.is_dir():
                continue

            # remove the top folder name that GitHub adds to the zip
            path = info.filename.split("/", 1)[1] if "/" in info.filename else info.filename

            if should_read(path, info.file_size):
                candidates.append((path, info))

        # files near the top of the project (README, main files) come first
        candidates.sort(key=lambda item: (item[0].count("/"), item[0].lower()))

        for path, info in candidates:
            if files_read >= MAX_FILES or len(chunks) >= MAX_CHUNKS:
                truncated = True
                break

            try:
                text = zf.read(info).decode("utf-8")
            except UnicodeDecodeError:
                continue

            if not text.strip():
                continue

            files_read += 1
            for piece in chunk_text(text, CHUNK_SIZE, CHUNK_OVERLAP):
                if len(chunks) >= MAX_CHUNKS:
                    truncated = True
                    break
                chunks.append(f"File: {path}\n{piece}")
                paths.append(path)

    if not chunks:
        raise ValueError("No readable code files were found in this repository.")

    print(
        f"Found {len(candidates)} readable files. "
        f"Using {files_read} files, {len(chunks)} pieces.",
        flush=True,
    )

    save_chunks(repo_name, chunks, paths)
    print("Done.", flush=True)

    return {
        "repo_name": repo_name,
        "files_read": files_read,
        "chunks_saved": len(chunks),
        "truncated": truncated,
    }