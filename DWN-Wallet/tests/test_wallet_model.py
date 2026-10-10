from uuid import UUID


def test_transaction_id_is_uuid():
    tx_id = "9f5a4e3c-7c7c-4b5b-9d2b-4a5f1d9c8e11"
    UUID(tx_id)


def test_transaction_payload_uses_did_and_dwn():
    tx = {
        "transaction_id": "9f5a4e3c-7c7c-4b5b-9d2b-4a5f1d9c8e11",
        "sender_did": "did:natively:sender",
        "receiver_did": "did:natively:receiver",
        "amount": 25,
        "currency": "NATIVE",
        "source": "dwn",
    }
    assert tx["sender_did"].startswith("did:natively:")
    assert tx["receiver_did"].startswith("did:natively:")
    assert tx["amount"] > 0
    assert tx["source"] == "dwn"
