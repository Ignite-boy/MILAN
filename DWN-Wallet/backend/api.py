from __future__ import annotations

from dataclasses import asdict
from typing import Any

from backend.account import UserAccount
from backend.dwn_store import InMemoryDWNStore
from backend.transfer import TransferResult, send_value


ACCOUNT_RECORD = "account"
TRANSACTION_RECORD = "transaction"


def create_account_record(did: str, display_name: str, store: InMemoryDWNStore) -> dict[str, Any]:
    account = UserAccount.create(did=did, display_name=display_name)
    record = asdict(account)
    record["record_id"] = f"account:{did}"
    record["source"] = "dwn"
    store.write_record(ACCOUNT_RECORD, record)
    return record


def send_transaction(
    sender_did: str,
    receiver_did: str,
    amount: float,
    store: InMemoryDWNStore,
) -> TransferResult:
    result = send_value(sender_did, receiver_did, amount, store)
    tx = result.transaction.to_record()
    store.write_record(TRANSACTION_RECORD, {
        "record_id": tx["transaction_id"],
        **tx,
        "source": "dwn",
    })
    return result


def list_user_transactions(did: str, store: InMemoryDWNStore) -> list[dict[str, Any]]:
    return [
        record
        for record in store.read_records(TRANSACTION_RECORD)
        if record.get("sender_did") == did or record.get("receiver_did") == did
    ]
