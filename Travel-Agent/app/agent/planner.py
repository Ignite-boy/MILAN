"""
Plan-and-Execute style planning: before letting the ReAct agent loose with
tools, ask the LLM to break the goal ("plan a 2-day trip to X") into a short
list of concrete subtasks. These subtasks are fed to the agent graph as
explicit instructions, giving the reasoning an explicit structure instead of
a single vague prompt.
"""
import re
from typing import List


_PLAN_PROMPT = """Break down planning a {days}-day trip to {city} (budget: {budget}) into \
4-6 concrete, concise subtasks an assistant should complete before writing the final \
itinerary. Examples of good subtasks: "Check the weather for the travel dates", \
"Find top attractions matching the user's interests", "Estimate flight and hotel cost \
for the given budget", "Look up any current travel advisories". Return ONLY a numbered \
list, one subtask per line, nothing else.
"""


def plan_trip(city: str, llm, days: int = 2, budget: str = "medium") -> List[str]:
    prompt = _PLAN_PROMPT.format(city=city, days=days, budget=budget)
    response = llm.invoke(prompt)
    content = response.content if hasattr(response, "content") else str(response)
    return parse_plan(content)


def parse_plan(content: str) -> List[str]:
    """Split out for unit testing without an LLM call."""
    if isinstance(content, list):
        content = "\n".join(
            item if isinstance(item, str) else str(item)
            for item in content
        )
    elif not isinstance(content, str):
        content = str(content)

    lines = []
    for line in content.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # strip leading "1.", "1)", "-", "*" etc.
        cleaned = re.sub(r"^[\-\*\d\.\)]+\s*", "", line).strip()
        if cleaned:
            lines.append(cleaned)
    return lines
