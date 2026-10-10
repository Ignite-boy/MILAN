"""
Multi-hop RAG retrieval over the attraction/travel-info FAISS index built by
app/rag/ingest.py.

Hop 1: broad query -> "<city> attractions <interest>"
Hop 2: pull out capitalised, named-entity-like phrases from the hop-1 text
       (candidate landmark/neighbourhood names) and re-query the index with
       those specific names -> more grounded, specific detail.

If the index has no data for a city yet (ingest.py hasn't been run), falls
back to the small curated data/attractions.json file so the tool never
returns nothing.
"""
import json
import os
import re
from typing import List, Optional

from app.config import settings
from app.llm import get_embeddings
from app.vectorstore import SimpleFAISSStore

_store: Optional[SimpleFAISSStore] = None
_embeddings = None

_STOPWORDS = {
    "The", "This", "That", "It", "In", "On", "At", "For", "With", "A", "An",
    "Tourism", "History", "Wikipedia", "See", "Also", "References",
}


def _get_store_and_embeddings():
    global _store, _embeddings
    if _store is None:
        _embeddings = get_embeddings()
        probe_dim = len(_embeddings.embed_query("dim_probe"))
        _store = SimpleFAISSStore(
            index_path=settings.RAG_INDEX_PATH, meta_path=settings.RAG_META_PATH, dim=probe_dim
        )
    return _store, _embeddings


def _extract_named_phrases(text: str, city: str, max_phrases: int = 4) -> List[str]:
    """Very lightweight named-entity heuristic: consecutive capitalised words."""
    candidates = re.findall(r"(?:[A-Z][a-zA-Z']+(?:\s+[A-Z][a-zA-Z']+)*)", text)
    seen, phrases = set(), []
    for c in candidates:
        c = c.strip()
        if (
            len(c) > 3
            and c not in _STOPWORDS
            and c.lower() != city.lower()
            and c not in seen
        ):
            seen.add(c)
            phrases.append(c)
        if len(phrases) >= max_phrases:
            break
    return phrases


def _load_fallback(city: str) -> Optional[str]:
    if not os.path.exists(settings.ATTRACTIONS_FALLBACK_PATH):
        return None
    with open(settings.ATTRACTIONS_FALLBACK_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    entry = data.get(city) or data.get(city.title()) or data.get(city.lower())
    if not entry:
        return None
    lines = [f"- {item}" for item in entry]
    return f"[static fallback data for {city}]\n" + "\n".join(lines)


def retrieve_attractions(city: str, interest: str = "general") -> str:
    store, embeddings = _get_store_and_embeddings()

    city_filter = lambda meta: meta.get("city", "").lower() == city.lower()  # noqa: E731

    hop1 = store.search(
        query=f"{city} top attractions {interest}",
        embed_query_fn=embeddings.embed_query,
        k=3,
        metadata_filter=city_filter,
    )

    if not hop1:
        fallback = _load_fallback(city)
        if fallback:
            return fallback
        return (
            f"No RAG data indexed yet for {city} (run `python -m app.rag.ingest "
            f"--cities \"{city}\"` to build it) and no static fallback entry exists. "
            f"Answer using general knowledge and say the info isn't verified."
        )

    hop1_text = "\n".join(text for text, _meta, _score in hop1)
    named_phrases = _extract_named_phrases(hop1_text, city)

    hop2 = []
    if named_phrases:
        hop2 = store.search(
            query=f"details about {' '.join(named_phrases)} in {city}",
            embed_query_fn=embeddings.embed_query,
            k=3,
            metadata_filter=city_filter,
        )

    combined, seen_text = [], set()
    for text, _meta, _score in hop1 + hop2:
        if text not in seen_text:
            seen_text.add(text)
            combined.append(text)

    return "\n---\n".join(combined)
