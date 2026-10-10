from __future__ import annotations

from dataclasses import dataclass

from backend.dwn_store import DWNStore
from backend.ledger import Transaction


@dataclass(frozen=True)
class TransferResult:
    transaction: Transaction
    sender_record_id: str
    receiver_record_id: str


def send_value(sender_did: str, receiver_did: str, amount: float, store: DWNStore) -> TransferResult:
    tx = Transaction.create(sender_did, receiver_did, amount)
    sender_record = store.write_record(
        "transaction",
        {"record_id": tx.transaction_id, "owner_did": sender_did, **tx.to_record()},
    )
    receiver_record = store.write_record(
        "transaction",
        {"record_id": tx.transaction_id, "owner_did": receiver_did, **tx.to_record()},
    )
    return TransferResult(tx, sender_record, receiver_record)
