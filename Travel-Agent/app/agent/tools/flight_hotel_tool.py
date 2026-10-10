import hashlib
from langchain_core.tools import tool

# Base price bands per budget tier (INR). A city-specific multiplier derived
# deterministically from the city name adds variety without needing a real
# flight/hotel API — swap this function's body for a real provider (Amadeus,
# Skyscanner, Booking.com API, etc.) later without touching the rest of the agent.
_BUDGET_BANDS = {
    "low": {"flight": 4000, "hotel": 1500},
    "medium": {"flight": 9000, "hotel": 3500},
    "high": {"flight": 20000, "hotel": 8000},
}


def _city_multiplier(city: str) -> float:
    h = int(hashlib.sha256(city.lower().encode()).hexdigest(), 16)
    return 0.85 + (h % 30) / 100  # roughly 0.85x - 1.14x


@tool
def search_flights_hotels(city: str, budget: str = "medium") -> str:
    """Get flight and hotel price estimates for a city.
    budget must be one of: 'low', 'medium', 'high'.
    Use this when the user asks about cost, booking, or trip budget.
    (Currently returns mock data — swap in a real flights/hotels API for production.)"""
    budget = budget.lower() if budget.lower() in _BUDGET_BANDS else "medium"
    band = _BUDGET_BANDS[budget]
    mult = _city_multiplier(city)
    flight = round(band["flight"] * mult, -2)
    hotel = round(band["hotel"] * mult, -2)
    return (
        f"[mock data] Round-trip flight to {city}: ~₹{int(flight)} | "
        f"Hotel per night ({budget} tier): ~₹{int(hotel)}"
    )
