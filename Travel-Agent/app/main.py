from fastapi import BackgroundTasks, FastAPI
from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.graph import SYSTEM_PROMPT, get_graph
from app.agent.intent import extract_intent
from app.agent.planner import plan_trip
from app.config import settings
from app.llm import get_llm
from app.memory.long_term import extract_and_save_preferences, get_preferences
from app.models.schemas import ChatRequest, ChatResponse, HealthResponse

app = FastAPI(
    title="AI Travel Planning Agent",
    description="LangGraph-based conversational agent for 2-day city trip planning.",
    version="1.0.0",
)


@app.get("/", include_in_schema=False)
def root():
    return {"message": "AI Travel Planning Agent is running. POST to /chat. See /docs for the schema."}


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        llm_provider=settings.LLM_PROVIDER,
        embedding_provider=settings.EMBEDDING_PROVIDER,
    )


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, background_tasks: BackgroundTasks):
    graph = get_graph()
    config = {"configurable": {"thread_id": req.session_id}}

    # Pull prior turns from the checkpointer (short-term memory) so the
    # intent extractor has context, and so we know whether this is a brand
    # new thread (needs a system prompt) or a continuing one.
    state = graph.get_state(config)
    prior_messages = state.values.get("messages", []) if state and state.values else []
    conversation_history = [
        f"{getattr(m, 'type', 'unknown')}: {getattr(m, 'content', '')}" for m in prior_messages
    ]

    llm = get_llm()
    intent = extract_intent(req.message, conversation_history, llm)

    if not intent["clear"]:
        return ChatResponse(
            response=intent["clarification_question"],
            needs_clarification=True,
            session_id=req.session_id,
        )

    # Long-term memory: pull anything we already know about this user for
    # this kind of trip, so the agent doesn't have to ask again.
    preferences = get_preferences(req.user_id, query=f"preferences for {intent['city']} trip")
    preferences_block = (
        "\n".join(f"- {p}" for p in preferences) if preferences else "(none recorded yet)"
    )

    # Plan-and-Execute: break the goal into subtasks before letting the
    # tool-using agent loose.
    subtasks = plan_trip(intent["city"], llm, days=intent["days"], budget=intent["budget"])
    subtasks_block = (
        "\n".join(f"{i + 1}. {t}" for i, t in enumerate(subtasks)) if subtasks else "(none)"
    )

    messages_to_send = []
    if not prior_messages:
        messages_to_send.append(
            SystemMessage(content=SYSTEM_PROMPT.format(preferences_block=preferences_block))
        )

    enriched_message = (
        f"{req.message}\n\n"
        f"[Internal plan — subtasks to cover before answering]\n{subtasks_block}\n\n"
        f"[Known user preferences]\n{preferences_block}"
    )
    messages_to_send.append(HumanMessage(content=enriched_message))

    result = graph.invoke({"messages": messages_to_send}, config=config)
    answer = result["messages"][-1].content

    if isinstance(answer, list):
        parts = []
        for item in answer:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
            elif isinstance(item, str):
                parts.append(item)
        answer = "\n".join(parts).strip()

    if not isinstance(answer, str):
        answer = str(answer)

    if settings.ENABLE_AUTO_PREFERENCE_EXTRACTION:
        background_tasks.add_task(
            extract_and_save_preferences,
            req.user_id,
            f"User: {req.message}\nAssistant: {answer}",
            llm,
        )

    return ChatResponse(response=answer, needs_clarification=False, session_id=req.session_id)
