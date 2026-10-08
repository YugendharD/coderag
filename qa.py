import time

from google import genai

from config import GEMINI_API_KEY, ANSWER_MODELS

client = genai.Client(api_key=GEMINI_API_KEY)


class AnswerUnavailable(Exception):
    """Raised when every model is busy or failing."""
    pass


def build_prompt(question, results):
    pieces = results["documents"][0]
    context = "\n\n---\n\n".join(pieces)

    return f"""You are a helpful assistant that answers questions about a GitHub repository.

Use ONLY the code and text pieces below to answer. If the answer is not in them,
say that you could not find it in the repository. Explain in simple, clear words,
and mention the file names you used.

CODE PIECES:
{context}

QUESTION: {question}

ANSWER:"""


def answer_question(question, results):
    prompt = build_prompt(question, results)
    last_error = None

    for model in ANSWER_MODELS:
        for attempt in range(2):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                )
                if response.text:
                    return response.text
            except Exception as error:
                last_error = error
                time.sleep(2)

    raise AnswerUnavailable(
        f"All answer models failed. Last error: {last_error}"
    )