from typing import Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str = Field(..., description="Stable ID for the user, used for long-term memory")
    session_id: str = Field(..., description="Conversation/thread ID, used for short-term memory")
    message: str = Field(..., description="The user's chat message")


class ChatResponse(BaseModel):
    response: str
    needs_clarification: bool = False
    session_id: str


class HealthResponse(BaseModel):
    status: str
    llm_provider: str
    embedding_provider: str
