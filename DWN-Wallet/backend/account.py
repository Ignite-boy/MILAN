from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from uuid import uuid4


@dataclass(frozen=True)
class AccountRecord:
    account_id: str
    did: str
    dwn: str
    balance: float = 0.0
    asset: str = "MDC"
    created_at: str = ""

    @classmethod
    def create(cls, did: str, dwn: str, asset: str = "MDC") -> "AccountRecord":
        if not did.startswith("did:natively:"):
            raise ValueError("did must use the natively DID namespace")
        if not dwn:
            raise ValueError("dwn is required")
        return cls(
            account_id=f"acct_{uuid4().hex}",
            did=did,
            dwn=dwn,
            asset=asset,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    def to_record(self) -> dict[str, object]:
        return asdict(self)
