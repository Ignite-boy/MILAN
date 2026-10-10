from __future__ import annotations

from typing import Any

ACCOUNT_RECORD_TYPE = "natively.account"
TRANSACTION_RECORD_TYPE = "natively.transaction"


def account_record(did: str, balance: float = 0.0) -> dict[str, Any]:
    if not did.startswith("did:"):
        raise ValueError("did must be a DID")
    if balance < 0:
        raise ValueError("balance cannot be negative")
    return {
        "record_type": ACCOUNT_RECORD_TYPE,
        "did": did,
        "balance": float(balance),
        "source": "dwn",
    }


def transaction_record(
    transaction_id: str,
    sender_did: str,
    receiver_did: str,
    amount: float,
    asset: str = "MDC",
) -> dict[str, Any]:
    if amount <= 0:
        raise ValueError("amount must be positive")
    return {
        "record_type": TRANSACTION_RECORD_TYPE,
        "transaction_id": transaction_id,
        "sender_did": sender_did,
        "receiver_did": receiver_did,
        "amount": float(amount),
        "asset": asset,
        "source": "dwn",
    }
