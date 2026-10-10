from langchain_core.tools import tool

from app.rag.retriever import retrieve_attractions


@tool
def get_attractions(city: str, interest: str = "general") -> str:
    """Retrieve top attractions/things-to-do for a city, optionally filtered
    by interest (e.g. 'museums', 'food', 'nightlife', 'nature', 'history').
    Uses multi-hop RAG over indexed Wikipedia/travel-blog content, falling
    back to curated static data if nothing is indexed yet for that city."""
    return retrieve_attractions(city, interest)
