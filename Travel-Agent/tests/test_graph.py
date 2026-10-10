from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool

from app.agent.graph import build_graph


@tool
def dummy_tool(x: str) -> str:
    """A dummy tool used only for testing the routing loop."""
    return f"tool result for {x}"


class FakeToolCallingLLM:
    """First invoke: emits a tool call. Second invoke: emits a final answer.
    Mimics the shape LangGraph expects from a real `.bind_tools()` model
    without needing Ollama/OpenAI reachable in the test environment."""

    def __init__(self):
        self.calls = 0

    def bind_tools(self, tools):
        return self

    def invoke(self, messages):
        self.calls += 1
        if self.calls == 1:
            return AIMessage(
                content="",
                tool_calls=[{"name": "dummy_tool", "args": {"x": "Tokyo"}, "id": "call_1"}],
            )
        return AIMessage(content="Here is your 2-day Tokyo itinerary: Day 1 ... Day 2 ...")


def test_agent_calls_tool_then_answers():
    fake_llm = FakeToolCallingLLM()
    graph = build_graph(llm=fake_llm, tools=[dummy_tool])
    config = {"configurable": {"thread_id": "test-session-1"}}

    result = graph.invoke({"messages": [HumanMessage(content="plan a trip to Tokyo")]}, config=config)

    final_message = result["messages"][-1]
    assert "itinerary" in final_message.content.lower()
    assert fake_llm.calls == 2  # exactly one tool round-trip before the final answer

    # a ToolMessage for dummy_tool should be present in the history
    tool_messages = [m for m in result["messages"] if getattr(m, "name", None) == "dummy_tool"]
    assert len(tool_messages) == 1
    assert "Tokyo" in tool_messages[0].content


def test_agent_short_circuits_when_no_tool_needed():
    class DirectAnswerLLM:
        def bind_tools(self, tools):
            return self

        def invoke(self, messages):
            return AIMessage(content="No tool needed, here's a direct answer.")

    graph = build_graph(llm=DirectAnswerLLM(), tools=[dummy_tool])
    config = {"configurable": {"thread_id": "test-session-2"}}
    result = graph.invoke({"messages": [HumanMessage(content="hi")]}, config=config)
    assert "direct answer" in result["messages"][-1].content.lower()


def test_short_term_memory_persists_across_turns():
    fake_llm = FakeToolCallingLLM()
    graph = build_graph(llm=fake_llm, tools=[dummy_tool])
    config = {"configurable": {"thread_id": "test-session-3"}}

    graph.invoke({"messages": [HumanMessage(content="plan a trip to Tokyo")]}, config=config)
    state = graph.get_state(config)
    # first turn produced: human + tool-call AI + tool result + final AI = 4 messages
    assert len(state.values["messages"]) == 4
