"""
Long-term memory: user preferences (budget, food, interests, etc.) embedded
and stored in a FAISS index, namespaced by user_id, persisted to disk so they
survive across sessions and process restarts.
"""
import json
import time
from typing import List, Optional

from app.config import settings
from app.llm import get_embeddings
from app.vectorstore import SimpleFAISSStore

_store: Optional[SimpleFAISSStore] = None
_embeddings = None


def _get_store_and_embeddings():
    """Lazily build the store on first use (so importing this module doesn't
    immediately require an embedding model to be reachable)."""
    global _store, _embeddings
    if _store is None:
        _embeddings = get_embeddings()
        probe_dim = len(_embeddings.embed_query("dim_probe"))
        _store = SimpleFAISSStore(
            index_path=settings.PREFS_INDEX_PATH,
            meta_path=settings.PREFS_META_PATH,
            dim=probe_dim,
        )
    return _store, _embeddings


def save_preference(user_id: str, text: str) -> None:
    store, embeddings = _get_store_and_embeddings()
    store.add_texts(
        texts=[text],
        metadatas=[{"user_id": user_id, "ts": time.time()}],
        embed_fn=embeddings.embed_documents,
    )


def get_preferences(user_id: str, query: str = "travel preferences", k: int = 5) -> List[str]:
    store, embeddings = _get_store_and_embeddings()
    results = store.search(
        query=query,
        embed_query_fn=embeddings.embed_query,
        k=k,
        metadata_filter=lambda m: m.get("user_id") == user_id,
    )
    return [text for text, _meta, _score in results]


_EXTRACTION_PROMPT = """You are analysing a conversation between a user and a travel-planning \
assistant. Extract any durable personal preferences the user revealed (budget level, food \
preferences e.g. vegetarian, interests e.g. museums/nightlife/nature, travel style e.g. \
backpacking/luxury, pace, pet-friendly needs, preferred language). Return ONLY a JSON list of \
short strings, one per preference. If there are none, return []. No preamble, no markdown fences.

Conversation:
{conversation}
"""


def parse_preference_json(raw_content: str) -> List[str]:
    """Pure parsing helper, split out so it's unit-testable without an LLM."""
    content = raw_content.strip()
    for fence in ("```json", "```"):
        if content.startswith(fence):
            content = content[len(fence):]
    if content.endswith("```"):
        content = content[: -len("```")]
    content = content.strip()
    try:
        prefs = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(prefs, list):
        return []
    return [p.strip() for p in prefs if isinstance(p, str) and p.strip()]


def extract_and_save_preferences(user_id: str, conversation_text: str, llm) -> List[str]:
    prompt = _EXTRACTION_PROMPT.format(conversation=conversation_text)
    raw = llm.invoke(prompt)
    content = raw.content if hasattr(raw, "content") else str(raw)
    prefs = parse_preference_json(content)
    for p in prefs:
        save_preference(user_id, p)
    return prefs
