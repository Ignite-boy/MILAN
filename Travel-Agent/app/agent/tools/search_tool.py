from langchain_core.tools import tool

from app.config import settings


@tool
def web_search(query: str) -> str:
    """Search the web for up-to-date travel information — current events,
    prices, visa rules, safety advisories, local news. Use this when your own
    knowledge might be outdated or when the user asks something time-sensitive."""
    if settings.TAVILY_API_KEY:
        try:
            from tavily import TavilyClient

            client = TavilyClient(api_key=settings.TAVILY_API_KEY)
            results = client.search(query, max_results=3)
            snippets = [r.get("content", "") for r in results.get("results", [])]
            if snippets:
                return "\n".join(snippets)
        except Exception as exc:  # noqa: BLE001
            return f"Tavily search failed ({exc}); falling back to Wikipedia summary."

    # Fallback: no Tavily key configured — use Wikipedia as a free substitute
    # for "current" info about the topic (not truly real-time, but keeps the
    # tool usable with zero API keys for local testing/demo).
    try:
        import wikipedia

        summary = wikipedia.summary(query, sentences=3, auto_suggest=True)
        return f"[wikipedia fallback, no TAVILY_API_KEY set] {summary}"
    except Exception as exc:  # noqa: BLE001
        return f"Search failed for '{query}': {exc}"
