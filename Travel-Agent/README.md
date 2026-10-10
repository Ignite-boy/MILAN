# AI Travel Planning Agent

A conversational agent that plans personalized 2-day trips for any city. Built with
**FastAPI + LangGraph + FAISS**, satisfying all four mandatory requirements: tool-use
with LLM-driven decision-making, short + long-term memory, Plan-and-Execute reasoning
with multi-hop RAG, and a deployable REST API.

---

## 1. Architecture

```
User → POST /chat
          │
          ▼
   Intent extraction (LLM) ──► unclear? ──► return clarification question, STOP
          │ clear
          ▼
   Long-term memory lookup (FAISS, namespaced by user_id)
          │
          ▼
   Plan-and-Execute planner (LLM breaks goal into subtasks)
          │
          ▼
   LangGraph agent loop, thread_id = session_id
    ┌─────────────────────────────────────────┐
    │  agent node (LLM + bound tools)          │
    │      │ tool call?                        │
    │      ├─ yes → tools node → back to agent │
    │      └─ no  → END                        │
    └─────────────────────────────────────────┘
    tools: get_weather | web_search | search_flights_hotels | get_attractions
          │
          ▼
   Final itinerary text → response
          │
          ▼
   (background) extract & save new preferences to long-term memory
```

The LLM decides which tool(s) to call and when — via `llm.bind_tools(tools)` and
LangGraph's `tools_condition` router. There is no `if city == "Tokyo": ...` branching
anywhere; the routing is entirely driven by what the model outputs.

---

## 2. Project Structure

```
travel-agent/
├── app/
│   ├── main.py                    # FastAPI app, /chat endpoint
│   ├── config.py                  # all env-var driven settings
│   ├── llm.py                     # get_llm() / get_embeddings() provider factory
│   ├── vectorstore.py             # shared FAISS store (add/search/persist)
│   ├── models/schemas.py          # Pydantic request/response models
│   ├── agent/
│   │   ├── graph.py               # LangGraph StateGraph — the agent itself
│   │   ├── planner.py             # Plan-and-Execute subtask breakdown
│   │   ├── intent.py              # clarification / intent extraction
│   │   └── tools/
│   │       ├── weather_tool.py
│   │       ├── search_tool.py
│   │       ├── flight_hotel_tool.py
│   │       └── attraction_tool.py
│   ├── memory/
│   │   └── long_term.py           # user preference store (save/get/extract)
│   └── rag/
│       ├── ingest.py              # builds the RAG index from Wikipedia/blogs
│       └── retriever.py           # multi-hop retrieval + static fallback
├── data/
│   ├── attractions.json           # static fallback for a few demo cities
│   └── faiss_index/               # generated at runtime (git-ignored)
├── tests/                         # 19 tests, all offline (fakes/mocks, no live LLM needed)
├── requirements.txt
├── Dockerfile
├── render.yaml
├── .env.example
└── README.md                      # this file
```

---

## 3. Tool Selection (why these 4, and why they're LLM-routed)

| Tool | Purpose | Live API | Fallback (no key) |
|---|---|---|---|
| `get_weather` | weather / packing questions | OpenWeatherMap | deterministic mock string |
| `web_search` | current events, prices, advisories | Tavily | Wikipedia summary |
| `search_flights_hotels` | budget / cost questions | *(mock by design — task allows this)* | deterministic mock, varies by city + budget tier |
| `get_attractions` | things to do, itinerary content | — | multi-hop RAG over Wikipedia index → static JSON |

Every tool is a plain Python function decorated with `@tool` and given a clear
docstring — that docstring **is** the tool's decision signal. The agent LLM reads all
four docstrings, reads the user's message, and decides for itself which to call, in
what order, and how many times, before producing a final answer. No tool is ever
called unconditionally.

---

## 4. Memory Design

**Short-term (conversation/session):** `langgraph.checkpoint.memory.MemorySaver`,
keyed by `thread_id = session_id`. LangGraph automatically persists and replays the
full message history for that thread on every `.invoke()` — no bespoke code needed.
(Swap `MemorySaver` → `SqliteSaver`/`PostgresSaver` for restart-safe persistence in
a real production deployment; `MemorySaver` is in-process RAM only.)

**Long-term (cross-session, per user):** a custom FAISS store
(`app/vectorstore.py` + `app/memory/long_term.py`), namespaced by `user_id`.
- `langchain-community`'s FAISS wrapper was deliberately **not** used — that package
  was sunset/archived upstream in mid-2026. Instead there's a ~90-line direct `faiss`
  wrapper with the same add/search/persist behaviour, and full control over metadata
  filtering (so one user's preferences never leak into another's).
- After every turn, a background task asks the LLM to extract durable preferences
  (budget, dietary needs, interests, pace, pet-friendly, language) from that turn as
  a JSON list, embeds each one, and stores it.
- On the next message (even in a brand-new session), preferences are retrieved by
  semantic similarity to the current request and folded into the agent's context —
  so "I'm vegetarian" said last week still applies today.

---

## 5. Planning & Multi-Hop RAG

- **Plan-and-Execute:** `app/agent/planner.py` asks the LLM to break "plan a 2-day
  trip to X" into 4–6 concrete subtasks (check weather, find attractions, estimate
  budget, etc.) *before* the tool-using agent runs. These subtasks are injected into
  the agent's input so its tool use is guided rather than open-ended guessing.
- **Multi-hop RAG:** `app/rag/retriever.py` — hop 1 queries the FAISS index broadly
  ("Tokyo top attractions museums"); it then extracts candidate named places from
  the hop-1 text (lightweight capitalised-phrase heuristic) and re-queries with those
  specific names for hop 2, then merges/deduplicates. If nothing is indexed for a
  city yet, it falls back to `data/attractions.json`.
- **Ingestion:** `python -m app.rag.ingest --cities "Tokyo,Paris,Singapore"` pulls
  each city's Wikipedia page (+ "Tourism in X"), chunks it, embeds it, and adds it to
  the index. Drop `.txt` files into `data/blogs/` to index travel-blog content too.

---

## 6. Setup Guide (local)

**Windows shortcut:** double-click `setup.bat` once, edit `.env` to add your key,
then use `run_ingest.bat` and `run_server.bat` for everything after — these always
use the project's own `venv`, so you can't accidentally run against system Python
(which is the #1 cause of "my .env changes aren't taking effect" confusion). If you
ever delete or replace the `venv` folder, just re-run `setup.bat`.

### 6a. Using Gemini (free tier, no credit card, recommended if you don't want to pay)
```bash
# 1. Get a free API key: https://aistudio.google.com/apikey (Google login, no card needed)

# 2. Project setup
git clone <your-repo-url> travel-agent && cd travel-agent
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # defaults already target Gemini

# 3. Paste your key into .env
#    GEMINI_API_KEY=AIza...

# 4. (optional but recommended) build the RAG index for the cities you'll demo
python -m app.rag.ingest --cities "Tokyo,Paris,Singapore"

# 5. Run
uvicorn app.main:app --reload
# → http://localhost:8000/docs for interactive API docs
```
Free tier limits (as of mid-2026): a handful of requests per minute, low hundreds per
day on `gemini-2.5-flash` — plenty for development and a demo, not for production
traffic. `app/rag/ingest.py` already embeds in small batches with pauses and retries
to stay under these limits. Your prompts/responses may be used by Google to improve
their models on the free tier; switch to a billed Gemini project (still cheap) if
that matters for you.

### 6b. Using Ollama instead (fully local, fully free, works offline)
```bash
ollama pull qwen2.5
ollama pull nomic-embed-text
ollama serve
```
Then in `.env`: `LLM_PROVIDER=ollama` and `EMBEDDING_PROVIDER=ollama`.

### 6c. Using OpenAI instead (paid, needs billing set up)
```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
EMBEDDING_PROVIDER=openai
```

### 6c. Zero-key smoke test (no LLM at all needed for this one)
```bash
EMBEDDING_PROVIDER=hash python -c "from app.rag.retriever import retrieve_attractions; print(retrieve_attractions('Tokyo'))"
```
This proves the FAISS + fallback wiring works even before any LLM/API key is
configured. `hash` embeddings are NOT semantically meaningful — only for this kind
of dependency-free sanity check, not for a real demo.

---

## 7. Running Tests
```bash
pip install pytest httpx
pytest -v
```
All 19 tests run fully offline — the agent's LLM, embeddings, and tools are faked/
mocked, so no Ollama/OpenAI/API keys are required to verify the logic (tool routing,
short-term memory persistence, clarification flow, preference-JSON parsing, FAISS
add/search/persist, mock tool determinism).

---

## 8. Example Request

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id": "nitesh", "session_id": "s1", "message": "Plan a 2-day trip to Tokyo, medium budget, I love museums"}'
```

First message with no city mentioned → gets a clarification question back instead of
a guess:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id": "nitesh", "session_id": "s2", "message": "help me plan a trip"}'
# → {"response": "Which city ke liye plan banau, aur kitne din ka trip hai?", "needs_clarification": true, ...}
```

---

## 9. Deployment (Render)

1. Push this repo to GitHub.
2. On Render: New → Blueprint → point at the repo (picks up `render.yaml`
   automatically), or New → Web Service → Environment: Docker.
3. Set `GEMINI_API_KEY` (get one free at https://aistudio.google.com/apikey —
   `render.yaml` already defaults `LLM_PROVIDER`/`EMBEDDING_PROVIDER` to `gemini` for
   the deployed service, since it needs no billing setup and Render's free tier can't
   run Ollama). Optionally set `OPENWEATHER_API_KEY` / `TAVILY_API_KEY` for live
   weather/search instead of the mock/Wikipedia fallback.
4. Deploy → REST API live at `https://<your-service>.onrender.com/chat`.

For AWS instead: build the same `Dockerfile`, push to ECR, run on ECS Fargate or a
single EC2 instance behind nginx — no code changes needed either way.

---

## 10. Bonus Features Support

- **Budget support:** already wired — `budget` flows from intent extraction through
  the planner into `search_flights_hotels`.
- **Pet-friendly:** add a `pet_friendly: bool` field to `ChatRequest` and thread it
  into the enriched message in `main.py`; the attraction/flight tools can filter on
  it once real APIs are swapped in.
- **Multilingual:** the agent has no hardcoded English-only prompts — Ollama models
  like `qwen2.5` and OpenAI's models both handle Hindi/Hinglish input reasonably
  well already.
