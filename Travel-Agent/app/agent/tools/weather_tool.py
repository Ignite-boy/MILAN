import requests
from langchain_core.tools import tool

from app.config import settings


@tool
def get_weather(city: str) -> str:
    """Get the current weather / forecast for a city. Use this when the user
    asks about weather, temperature, what to pack, or the best time to visit."""
    if not settings.OPENWEATHER_API_KEY:
        return (
            f"[mock weather] {city}: no OPENWEATHER_API_KEY configured, "
            f"assume mild 22-28°C, light chance of rain — pack a light jacket."
        )
    try:
        resp = requests.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={
                "q": city,
                "appid": settings.OPENWEATHER_API_KEY,
                "units": "metric",
            },
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        desc = data["weather"][0]["description"]
        temp = data["main"]["temp"]
        feels = data["main"]["feels_like"]
        return f"{city}: {desc}, {temp}°C (feels like {feels}°C)"
    except Exception as exc:  # noqa: BLE001
        return f"Weather lookup failed for {city}: {exc}. Proceed assuming mild weather."
