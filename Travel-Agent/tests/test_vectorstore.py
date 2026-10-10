from app.vectorstore import SimpleFAISSStore


def _fake_embed_documents(texts):
    # Deterministic toy embedding: pad/truncate char-codes to a fixed dim.
    dim = 8
    vectors = []
    for t in texts:
        base = [float(ord(c)) for c in t.lower() if c.isalpha()]
        base = (base + [0.0] * dim)[:dim]
        vectors.append(base)
    return vectors


def _fake_embed_query(text):
    return _fake_embed_documents([text])[0]


def test_add_and_search_roundtrip(tmp_path):
    store = SimpleFAISSStore(
        index_path=str(tmp_path / "t.index"), meta_path=str(tmp_path / "t_meta.json"), dim=8
    )
    store.add_texts(
        texts=["I love museums", "I am vegetarian", "budget traveller"],
        metadatas=[{"user_id": "u1"}, {"user_id": "u1"}, {"user_id": "u2"}],
        embed_fn=_fake_embed_documents,
    )
    assert store.count() == 3

    results = store.search(
        "museums", _fake_embed_query, k=5, metadata_filter=lambda m: m["user_id"] == "u1"
    )
    assert len(results) == 2
    assert all(r[1]["user_id"] == "u1" for r in results)


def test_persists_and_reloads(tmp_path):
    index_path, meta_path = str(tmp_path / "p.index"), str(tmp_path / "p_meta.json")
    store1 = SimpleFAISSStore(index_path=index_path, meta_path=meta_path, dim=8)
    store1.add_texts(["hello world"], [{"user_id": "u1"}], _fake_embed_documents)

    store2 = SimpleFAISSStore(index_path=index_path, meta_path=meta_path, dim=8)
    assert store2.count() == 1


def test_empty_store_search_returns_empty(tmp_path):
    store = SimpleFAISSStore(
        index_path=str(tmp_path / "e.index"), meta_path=str(tmp_path / "e_meta.json"), dim=8
    )
    assert store.search("anything", _fake_embed_query) == []
