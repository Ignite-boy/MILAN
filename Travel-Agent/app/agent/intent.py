"""
Runs before the main agent graph on every turn. Asks the LLM to extract
structured trip intent (city, number of days, budget) from the user's
message + recent conversation, and to flag whether anything essential is
missing. If something's missing, the API returns the clarification question
directly instead of invoking the full tool-using agent — cheaper and avoids
the agent guessing at a city that was never mentioned.
"""
import json
from typing import List, Optional, TypedDict


class Intent(TypedDict):
    city: Optional[str]
    days: Optional[int]
    budget: Optional[str]
    clear: bool
    clarification_question: Optional[str]


_INTENT_PROMPT = """Extract the trip-planning intent from this conversation. Return ONLY a \
JSON object with keys: "city" (string or null), "days" (integer or null, default 2 if the \
user clearly wants a trip but didn't say how long), "budget" (one of "low", "medium", \
"high", or null), "clear" (boolean — true only if you have enough info to start planning, \
i.e. at minimum a city), "clarification_question" (a short, friendly question to ask if \
clear is false, else null). No markdown fences, no preamble.

Conversation so far:
{conversation}

Latest user message:
{message}
"""

_DEFAULT_INTENT: Intent = {
    "city": None,
    "days": 2,
    "budget": "medium",
    "clear": False,
    "clarification_question": "Which city ke liye plan banau, aur kitne din ka trip hai?",
}


def _stringify_content(raw_content) -> str:
    """Normalize LLM message content to a plain string.

    Newer Gemini model responses sometimes return `content` as a list of
    parts (e.g. [{"type": "text", "text": "..."}]) instead of a plain
    string. Flatten it here so downstream parsing always gets a string.
    """
    if isinstance(raw_content, list):
        parts = []
        for part in raw_content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            else:
                parts.append(str(part))
        return "".join(parts)
    if raw_content is None:
        return ""
    return str(raw_content)


def parse_intent_json(raw_content) -> Intent:
    """Pure parsing helper, unit-testable without an LLM."""
    content = _stringify_content(raw_content).strip()
    for fence in ("```json", "```"):
        if content.startswith(fence):
            content = content[len(fence):]
    if content.endswith("```"):
        content = content[: -len("```")]
    content = content.strip()
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return dict(_DEFAULT_INTENT)
    if not isinstance(data, dict):
        return dict(_DEFAULT_INTENT)
    return {
        "city": data.get("city"),
        "days": data.get("days") or 2,
        "budget": data.get("budget") or "medium",
        "clear": bool(data.get("clear")) and bool(data.get("city")),
        "clarification_question": data.get("clarification_question")
        or _DEFAULT_INTENT["clarification_question"],
    }


def extract_intent(message: str, conversation_history: List[str], llm) -> Intent:
    prompt = _INTENT_PROMPT.format(
        conversation="\n".join(conversation_history[-10:]) or "(no prior turns)",
        message=message,
    )
    raw = llm.invoke(prompt)
    content = raw.content if hasattr(raw, "content") else str(raw)
    return parse_intent_json(content)
