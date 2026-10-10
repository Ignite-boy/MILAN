from app.agent.tools.flight_hotel_tool import search_flights_hotels
from app.agent.tools.weather_tool import get_weather


def test_flight_hotel_mock_is_deterministic():
    r1 = search_flights_hotels.invoke({"city": "Tokyo", "budget": "low"})
    r2 = search_flights_hotels.invoke({"city": "Tokyo", "budget": "low"})
    assert r1 == r2
    assert "Tokyo" in r1
    assert "mock data" in r1


def test_flight_hotel_budget_tiers_differ():
    low = search_flights_hotels.invoke({"city": "Paris", "budget": "low"})
    high = search_flights_hotels.invoke({"city": "Paris", "budget": "high"})
    assert low != high


def test_weather_tool_mock_fallback_without_api_key(monkeypatch):
    monkeypatch.setattr("app.agent.tools.weather_tool.settings.OPENWEATHER_API_KEY", "")
    result = get_weather.invoke({"city": "Singapore"})
    assert "mock weather" in result
    assert "Singapore" in result
