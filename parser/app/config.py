import os

from dotenv import load_dotenv

load_dotenv()

PARSER_PORT = int(os.getenv("PARSER_PORT", "8100"))
PARSER_SHARED_SECRET = os.getenv("PARSER_SHARED_SECRET", "").strip()

# Limite de tamanho do upload aceito (bytes). Extratos são pequenos.
MAX_UPLOAD_BYTES = int(os.getenv("PARSER_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
