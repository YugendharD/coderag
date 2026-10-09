import chromadb

from embeddings import embed_documents, embed_query

# The database is saved in a folder called chroma_db
client = chromadb.PersistentClient(path="chroma_db")


def make_collection_name(repo_name):
    """Make a safe database name from a repo name."""
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in repo_name)
    safe = safe[:200].rstrip("._-")
    return "repo_" + safe


def save_chunks(repo_name, chunks, paths, progress=None):
    """Embed every chunk, then replace the stored copy of this repo.

    The old copy is only removed AFTER all embeddings succeeded, so a
    failure never leaves the repo empty.
    """
    name = make_collection_name(repo_name)

    def on_embed_progress(done, total):
        if progress:
            progress("Embedding pieces", done, total)

    # 1. Do the slow part first (this can fail if Google is busy)
    vectors = embed_documents(chunks, on_progress=on_embed_progress)

    # 2. Only now replace the old data
    if progress:
        progress("Saving to the database")

    try:
        client.delete_collection(name)
    except Exception:
        pass  # nothing to delete the first time

    collection = client.create_collection(name)

    batch_size = 100
    for start in range(0, len(chunks), batch_size):
        end = start + batch_size
        collection.add(
            ids=[f"{repo_name}-{i}" for i in range(start, min(end, len(chunks)))],
            documents=chunks[start:end],
            embeddings=vectors[start:end],
            metadatas=[{"path": p} for p in paths[start:end]],
        )

    return collection


def get_collection(repo_name):
    """Return the stored repo, or None if it was never ingested."""
    try:
        return client.get_collection(make_collection_name(repo_name))
    except Exception:
        return None


def query_collection(collection, question, n_results=6):
    """Find the code pieces that best match the question."""
    vector = embed_query(question)
    return collection.query(query_embeddings=[vector], n_results=n_results)