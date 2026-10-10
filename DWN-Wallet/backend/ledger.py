from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from uuid import uuid4


@dataclass(frozen=True)
class Transaction:
    transaction_id: str
    sender_did: str
    receiver_did: str
    amount: float
    asset: str
    created_at: str
    status: str = "pending"

    @classmethod
    def create(cls, sender_did: str, receiver_did: str, amount: float, asset: str = "MDC") -> "Transaction":
        if amount <= 0:
            raise ValueError("amount must be positive")
        if not sender_did or not receiver_did:
            raise ValueError("sender_did and receiver_did are required")
        return cls(
            transaction_id=f"txn_{uuid4().hex}",
            sender_did=sender_did,
            receiver_did=receiver_did,
            amount=float(amount),
            asset=asset,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    def to_record(self) -> dict[str, object]:
        return asdict(self)
