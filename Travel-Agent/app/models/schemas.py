from typing import Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    # Optional for backwards-compatible payload shape; when present it must match
    # the user identity verified from the MILAN Bearer token.
    user_id: Optional[str] = Field(default=None, min_length=1, max_length=256, description="Optional asserted user ID; validated against the authenticated MILAN identity")
    session_id: str = Field(..., min_length=1, max_length=128, description="Conversation/thread ID, namespaced under the verified user")
    message: str = Field(..., min_length=1, max_length=10000, description="The user's chat message")


class ChatResponse(BaseModel):
    response: str
    needs_clarification: bool = False
    session_id: str


class HealthResponse(BaseModel):
    status: str
    llm_provider: str
    embedding_provider: str
