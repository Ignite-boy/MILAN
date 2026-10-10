"""
Builds the attraction/travel-info RAG index.

Run standalone:
    python -m app.rag.ingest --cities "Tokyo,Paris,Singapore"

Pulls the Wikipedia page for each city (+ a couple of related pages like
"Tourism in <city>"), chunks the text, embeds it, and stores it in the shared
FAISS store. Also picks up any *.txt files under data/blogs/ as extra travel
blog content if present.

Embeds in small batches with a short delay between them, and retries on 429s,
to stay under free-tier rate limits (Gemini/OpenAI free tiers allow limited
requests per minute — hammering them with hundreds of chunks at once fails).
"""
import argparse
import glob
import os
import time

from app.config import settings
from app.llm import get_embeddings
from app.vectorstore import SimpleFAISSStore

# Wikipedia articles can run to tens of thousands of characters; for trip
# planning purposes the intro + first few sections are what matter, and
# capping this keeps the number of embedding calls (and free-tier quota
# usage) low.
MAX_ARTICLE_CHARS = 6000

# Free tiers (Gemini, OpenAI) typically allow well under 100 embedding
# requests/minute. Keep batches small and pause between them.
EMBED_BATCH_SIZE = 10
PAUSE_BETWEEN_BATCHES_SECONDS = 3
MAX_RETRIES_PER_BATCH = 4


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> list:
    """Simple sliding-window chunker over paragraphs — no extra dependency needed."""
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    joined = "\n".join(paragraphs)
    chunks = []
    start = 0
    while start < len(joined):
        end = start + chunk_size
        chunks.append(joined[start:end])
        start = end - overlap
        if start < 0 or end >= len(joined):
            break
    return [c for c in chunks if len(c) > 50]


def fetch_wikipedia_chunks(city: str) -> list:
    import wikipedia

    docs = []
    for query in (city, f"Tourism in {city}"):
        try:
            page = wikipedia.page(query, auto_suggest=True)
            content = page.content[:MAX_ARTICLE_CHARS]
            for chunk in chunk_text(content):
                docs.append({"text": chunk, "metadata": {"city": city, "source": page.url}})
        except Exception as exc:  # noqa: BLE001
            print(f"  [skip] '{query}' -> {exc}")
    return docs


def load_blog_chunks() -> list:
    docs = []
    for path in glob.glob(os.path.join(settings.DATA_DIR, "blogs", "*.txt")):
        city = os.path.splitext(os.path.basename(path))[0].replace("_", " ")
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        for chunk in chunk_text(text):
            docs.append({"text": chunk, "metadata": {"city": city, "source": path}})
    return docs


def _embed_batch_with_retry(store: SimpleFAISSStore, texts: list, metadatas: list, embed_fn):
    delay = 10
    for attempt in range(1, MAX_RETRIES_PER_BATCH + 1):
        try:
            store.add_texts(texts=texts, metadatas=metadatas, embed_fn=embed_fn)
            return
        except Exception as exc:  # noqa: BLE001
            is_rate_limit = "429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc)
            if not is_rate_limit or attempt == MAX_RETRIES_PER_BATCH:
                raise
            print(f"  Rate limited, waiting {delay}s before retry {attempt}/{MAX_RETRIES_PER_BATCH}...")
            time.sleep(delay)
            delay *= 2


def build_index(cities: list) -> int:
    embeddings = get_embeddings()
    probe_dim = len(embeddings.embed_query("dim_probe"))
    store = SimpleFAISSStore(
        index_path=settings.RAG_INDEX_PATH, meta_path=settings.RAG_META_PATH, dim=probe_dim
    )

    all_docs = load_blog_chunks()
    for city in cities:
        print(f"Fetching Wikipedia content for {city}...")
        all_docs.extend(fetch_wikipedia_chunks(city))

    if not all_docs:
        print("No documents gathered — nothing added to the index.")
        return 0

    total = len(all_docs)
    print(f"Embedding {total} chunks in batches of {EMBED_BATCH_SIZE}...")
    for i in range(0, total, EMBED_BATCH_SIZE):
        batch = all_docs[i : i + EMBED_BATCH_SIZE]
        _embed_batch_with_retry(
            store,
            texts=[d["text"] for d in batch],
            metadatas=[d["metadata"] for d in batch],
            embed_fn=embeddings.embed_documents,
        )
        done = min(i + EMBED_BATCH_SIZE, total)
        print(f"  {done}/{total} embedded")
        if done < total:
            time.sleep(PAUSE_BETWEEN_BATCHES_SECONDS)

    print(f"Added {total} chunks. Index now has {store.count()} vectors total.")
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cities", type=str, required=True, help="Comma-separated city names, e.g. 'Tokyo,Paris'"
    )
    args = parser.parse_args()
    city_list = [c.strip() for c in args.cities.split(",") if c.strip()]
    build_index(city_list)
