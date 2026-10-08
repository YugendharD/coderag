from google import genai
from config import GEMINI_API_KEY

client = genai.Client(api_key=GEMINI_API_KEY)

for model in client.models.list():
    name = model.name
    if "flash" in name or "embed" in name:
        print(name)