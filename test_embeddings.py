import math

from embeddings import embed_documents

texts = [
    "A cat is sleeping on the sofa.",
    "A kitten is napping on the couch.",
    "How to file income tax returns online.",
]

vectors = embed_documents(texts)

print("Number of vectors:", len(vectors))
print("Numbers in each vector:", len(vectors[0]))


def similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    size_a = math.sqrt(sum(x * x for x in a))
    size_b = math.sqrt(sum(y * y for y in b))
    return dot / (size_a * size_b)


print("cat vs kitten:", round(similarity(vectors[0], vectors[1]), 3))
print("cat vs taxes: ", round(similarity(vectors[0], vectors[2]), 3))