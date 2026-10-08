import chromadb

from embeddings import embed_documents, embed_query

# The database is saved in a folder called chroma_db
client = chromadb.PersistentClient(path="chroma_db")


def make_collection_name(repo_name):
    """Make a safe database name from a repo name."""
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in repo_name)
    safe = safe[:200].rstrip("._-")
    return "repo_" + safe


def save_chunks(repo_name, chunks, paths):
    """Embed every chunk and store it. Replaces older data for this repo."""
    name = make_collection_name(repo_name)

    try:
        client.delete_collection(name)
    except Exception:
        pass  # nothing to delete the first time

    collection = client.create_collection(name)

    batch_size = 50
    total = len(chunks)

    for start in range(0, total, batch_size):
        batch_chunks = chunks[start:start + batch_size]
        batch_paths = paths[start:start + batch_size]

        end = start + len(batch_chunks)
        print(f"Embedding pieces {start + 1}-{end} of {total} ...", flush=True)
        vectors = embed_documents(batch_chunks)

        collection.add(
            ids=[f"{repo_name}-{start + i}" for i in range(len(batch_chunks))],
            documents=batch_chunks,
            embeddings=vectors,
            metadatas=[{"path": p} for p in batch_paths],
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