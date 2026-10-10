"""
A small, dependency-light FAISS store shared by:
  - app/rag/retriever.py     (Wikipedia/travel-blog chunks, for attraction RAG)
  - app/memory/long_term.py  (user preference statements, for cross-session memory)

Note: `langchain_community.vectorstores.FAISS` exists but the langchain-community
package has been sunset/archived upstream (mid-2026), so this project talks to
`faiss` directly instead of depending on it. This is ~80 lines and gives full
control over persistence format and metadata filtering.
"""
import json
import os
import threading
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple

import faiss
import numpy as np


@dataclass
class Record:
    text: str
    metadata: dict = field(default_factory=dict)


class SimpleFAISSStore:
    def __init__(self, index_path: str, meta_path: str, dim: int):
        self.index_path = index_path
        self.meta_path = meta_path
        self.dim = dim
        self._lock = threading.Lock()
        self._index: Optional[faiss.Index] = None
        self._records: List[Record] = []
        self._load()

    def _load(self):
        if os.path.exists(self.index_path) and os.path.exists(self.meta_path):
            self._index = faiss.read_index(self.index_path)
            with open(self.meta_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            self._records = [Record(**r) for r in raw]
        else:
            self._index = faiss.IndexFlatIP(self.dim)  # cosine sim via normalized vectors
            self._records = []

    def _persist(self):
        os.makedirs(os.path.dirname(self.index_path), exist_ok=True)
        faiss.write_index(self._index, self.index_path)
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump([r.__dict__ for r in self._records], f)

    @staticmethod
    def _normalize(vectors: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return vectors / norms

    def add_texts(self, texts: List[str], metadatas: List[dict], embed_fn: Callable[[List[str]], List[List[float]]]):
        if not texts:
            return
        vectors = np.array(embed_fn(texts), dtype="float32")
        vectors = self._normalize(vectors)
        with self._lock:
            self._index.add(vectors)
            for t, m in zip(texts, metadatas):
                self._records.append(Record(text=t, metadata=m))
            self._persist()

    def search(
        self,
        query: str,
        embed_query_fn: Callable[[str], List[float]],
        k: int = 3,
        metadata_filter: Optional[Callable[[dict], bool]] = None,
    ) -> List[Tuple[str, dict, float]]:
        if self._index.ntotal == 0:
            return []
        qvec = np.array([embed_query_fn(query)], dtype="float32")
        qvec = self._normalize(qvec)
        # over-fetch when filtering so we still return k relevant results
        fetch_k = k * 5 if metadata_filter else k
        fetch_k = min(fetch_k, self._index.ntotal)
        scores, ids = self._index.search(qvec, fetch_k)
        results = []
        for score, idx in zip(scores[0], ids[0]):
            if idx == -1 or idx >= len(self._records):
                continue
            rec = self._records[idx]
            if metadata_filter and not metadata_filter(rec.metadata):
                continue
            results.append((rec.text, rec.metadata, float(score)))
            if len(results) >= k:
                break
        return results

    def count(self) -> int:
        return self._index.ntotal if self._index is not None else 0
