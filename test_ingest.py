from ingest import ingest_repo
from vector_store import get_collection, query_collection

result = ingest_repo("https://github.com/YugendharD/devpulse")
print(result)

collection = get_collection(result["repo_name"])
print("Chunks in database:", collection.count())

results = query_collection(collection, "What does the SearchBar component do?")

print("Best matching files:")
for meta in results["metadatas"][0]:
    print(" -", meta["path"])