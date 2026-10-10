"""
The core agent graph.

Design (satisfies "agent decides which tool to use, no hardcoded flow"):
  agent node -> LLM (with tools bound) reasons over the message history and
                either calls a tool or produces a final answer
  tools_condition -> routes to the "tools" node ONLY if the LLM's last
                message contains a tool call; otherwise routes to END
  tools node -> executes whichever tool(s) the LLM asked for, appends the
                ToolMessage results back into the message history
  -> loops back to agent node so the LLM can use the tool results (and
     decide whether it needs another tool, or is ready to answer)

Short-term memory: the MemorySaver checkpointer keeps the full message
history per thread_id (== session_id in the API), so multi-turn context is
maintained automatically — nothing bespoke needed here.
"""
from typing import List, Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, START, MessagesState
from langgraph.prebuilt import ToolNode, tools_condition

from app.agent.tools.attraction_tool import get_attractions
from app.agent.tools.flight_hotel_tool import search_flights_hotels
from app.agent.tools.search_tool import web_search
from app.agent.tools.weather_tool import get_weather
from app.llm import get_llm

DEFAULT_TOOLS = [get_weather, web_search, search_flights_hotels, get_attractions]

SYSTEM_PROMPT = (
    "You are a helpful, concise AI travel planning assistant. You have tools "
    "for weather, web search, flight/hotel prices, and city attractions. "
    "Decide for yourself which tool(s) are needed based on what the user is "
    "asking — do not call a tool you don't need. When you have enough "
    "information, produce a clear day-wise itinerary or a direct answer. "
    "If the user has known preferences listed below, weave them into your "
    "recommendations without being asked again.\n\n{preferences_block}"
)


def build_graph(llm=None, tools: Optional[List] = None, checkpointer=None):
    """Factory so tests can inject a fake LLM / fake tools / no checkpointer."""
    llm = llm if llm is not None else get_llm()
    tools = tools if tools is not None else DEFAULT_TOOLS
    checkpointer = checkpointer if checkpointer is not None else MemorySaver()

    llm_with_tools = llm.bind_tools(tools)

    def agent_node(state: MessagesState):
        return {"messages": [llm_with_tools.invoke(state["messages"])]}

    builder = StateGraph(MessagesState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", ToolNode(tools))
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", tools_condition)
    builder.add_edge("tools", "agent")

    return builder.compile(checkpointer=checkpointer)


# Module-level singleton used by the FastAPI app in normal operation.
_graph = None


def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
