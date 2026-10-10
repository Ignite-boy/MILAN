"""
Factory functions for the chat LLM and the embedding model.

Kept in one place so every other module (agent graph, planner, intent
extractor, RAG, long-term memory) asks for `get_llm()` / `get_embeddings()`
instead of importing a specific provider directly. Swapping Ollama <-> OpenAI
is then a one-line env var change (LLM_PROVIDER / EMBEDDING_PROVIDER),
nothing else in the codebase needs to change.
"""
import hashlib
import struct
from typing import List

from app.config import settings


def get_llm(temperature: float = 0.0):
    """Return a chat model instance based on LLM_PROVIDER."""
    if settings.LLM_PROVIDER == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=settings.OPENAI_MODEL,
            api_key=settings.OPENAI_API_KEY,
            temperature=temperature,
        )
    if settings.LLM_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=temperature,
        )
    # default: ollama (local, free, works fully offline once the model is pulled)
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_BASE_URL,
        temperature=temperature,
    )


class HashEmbeddings:
    """
    Dependency-free fallback embedding function.

    Not semantically meaningful like a real model, but deterministic and
    self-contained — useful so the whole project (FAISS wiring, memory
    read/write, tests) runs and is demoable even before Ollama/OpenAI is
    configured. Swap EMBEDDING_PROVIDER to "ollama" or "openai" for real
    semantic search quality.
    """

    def __init__(self, dim: int = 384):
        self.dim = dim

    def _vector(self, text: str) -> List[float]:
        vec = [0.0] * self.dim
        for token in text.lower().split():
            h = hashlib.sha256(token.encode("utf-8")).digest()
            idx = struct.unpack("I", h[:4])[0] % self.dim
            sign = 1.0 if h[4] % 2 == 0 else -1.0
            vec[idx] += sign
        norm = sum(v * v for v in vec) ** 0.5
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> List[float]:
        return self._vector(text)


def get_embeddings():
    """Return an embeddings instance based on EMBEDDING_PROVIDER."""
    if settings.EMBEDDING_PROVIDER == "openai":
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(
            model=settings.OPENAI_EMBED_MODEL, api_key=settings.OPENAI_API_KEY
        )
    if settings.EMBEDDING_PROVIDER == "gemini":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        return GoogleGenerativeAIEmbeddings(
            model=settings.GEMINI_EMBED_MODEL, google_api_key=settings.GEMINI_API_KEY
        )
    if settings.EMBEDDING_PROVIDER == "ollama":
        from langchain_ollama import OllamaEmbeddings

        return OllamaEmbeddings(
            model=settings.OLLAMA_EMBED_MODEL, base_url=settings.OLLAMA_BASE_URL
        )
    return HashEmbeddings(dim=settings.HASH_EMBED_DIM)
