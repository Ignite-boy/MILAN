from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class DWNStore(Protocol):
    """Minimal interface for user-owned DWN record storage."""

    def write_record(self, record_type: str, data: dict[str, Any]) -> str:
        ...

    def read_records(self, record_type: str) -> list[dict[str, Any]]:
        ...


@dataclass
class InMemoryDWNStore:
    """Development adapter; replace with a real DWN client in production."""

    records: dict[str, list[dict[str, Any]]]

    def __init__(self) -> None:
        self.records = {}

    def write_record(self, record_type: str, data: dict[str, Any]) -> str:
        items = self.records.setdefault(record_type, [])
        record = dict(data)
        record_id = record.get("record_id")
        if not record_id:
            raise ValueError("record_id is required")
        items.append(record)
        return str(record_id)

    def read_records(self, record_type: str) -> list[dict[str, Any]]:
        return [dict(item) for item in self.records.get(record_type, [])]
