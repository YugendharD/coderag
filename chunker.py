def chunk_text(text, chunk_size=800, overlap=100):
    """Cut a long text into small overlapping pieces."""
    if chunk_size <= overlap:
        raise ValueError("chunk_size must be bigger than overlap")

    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])

        if end >= len(text):
            break

        start = start + chunk_size - overlap

    return chunks
