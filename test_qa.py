from vector_store import get_collection, query_collection
from qa import answer_question

repo_name = "YugendharD_devpulse"
question = "What does the SearchBar component do?"

collection = get_collection(repo_name)

if collection is None:
    print("This repo has not been ingested yet. Run test_ingest.py first.")
else:
    results = query_collection(collection, question)
    answer = answer_question(question, results)
    print("QUESTION:", question)
    print()
    print("ANSWER:")
    print(answer)