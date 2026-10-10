"""
Central configuration. Everything is read from environment variables so the
same code runs unchanged on a laptop, in Docker, or on Render — only the
.env / dashboard env vars change.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def _bool(val: str, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    # --- LLM provider: "ollama" (local, free), "openai" (hosted, paid),
    #     or "gemini" (hosted, free tier available, no credit card needed) ---
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

    # --- Embeddings provider: "ollama", "openai", "gemini", or "hash" (no
    #     external deps, used automatically as a safe fallback for local
    #     dev/testing) ---
    EMBEDDING_PROVIDER: str = os.getenv("EMBEDDING_PROVIDER", "hash")
    OLLAMA_EMBED_MODEL: str = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    OPENAI_EMBED_MODEL: str = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
    GEMINI_EMBED_MODEL: str = os.getenv("GEMINI_EMBED_MODEL", "models/gemini-embedding-001")
    HASH_EMBED_DIM: int = int(os.getenv("HASH_EMBED_DIM", "384"))

    # --- External tool APIs (optional — tools fall back to mock data if unset) ---
    OPENWEATHER_API_KEY: str = os.getenv("OPENWEATHER_API_KEY", "")
    TAVILY_API_KEY: str = os.getenv("TAVILY_API_KEY", "")

    # --- Storage paths ---
    DATA_DIR: str = os.getenv("DATA_DIR", "data")
    RAG_INDEX_PATH: str = os.getenv(
        "RAG_INDEX_PATH", os.path.join(DATA_DIR, "faiss_index", "rag.index")
    )
    RAG_META_PATH: str = os.getenv(
        "RAG_META_PATH", os.path.join(DATA_DIR, "faiss_index", "rag_meta.json")
    )
    PREFS_INDEX_PATH: str = os.getenv(
        "PREFS_INDEX_PATH", os.path.join(DATA_DIR, "faiss_index", "user_prefs.index")
    )
    PREFS_META_PATH: str = os.getenv(
        "PREFS_META_PATH", os.path.join(DATA_DIR, "faiss_index", "user_prefs_meta.json")
    )
    ATTRACTIONS_FALLBACK_PATH: str = os.getenv(
        "ATTRACTIONS_FALLBACK_PATH", os.path.join(DATA_DIR, "attractions.json")
    )

    # --- App behaviour ---
    ENABLE_AUTO_PREFERENCE_EXTRACTION: bool = _bool(
        os.getenv("ENABLE_AUTO_PREFERENCE_EXTRACTION", "true")
    )


settings = Settings()
