from chunker import chunk_text

sample = "abcdefghij" * 100  # a fake text that is 1000 characters long

chunks = chunk_text(sample, chunk_size=300, overlap=50)

print("Number of chunks:", len(chunks))
for i, piece in enumerate(chunks):
    print("Chunk", i, "has", len(piece), "characters")