import pytest

from app.agent.intent import parse_intent_json
from app.agent.planner import parse_plan
from app.memory.long_term import parse_preference_json

INTENT_CASES = [
    ('{"city":"Tokyo","days":1,"budget":"low","clear":true}', "Tokyo", 1, "low", True),
    ('{"city":"Tokyo","days":2,"budget":"medium","clear":true}', "Tokyo", 2, "medium", True),
    ('{"city":"Tokyo","days":7,"budget":"high","clear":true}', "Tokyo", 7, "high", True),
    ('{"city":"Paris","days":3,"budget":"medium","clear":true}', "Paris", 3, "medium", True),
    ('{"city":"Delhi","days":5,"budget":"medium","clear":true}', "Delhi", 5, "medium", True),
    ('{"city":"Dubai","days":4,"budget":"medium","clear":true}', "Dubai", 4, "medium", True),
    ('{"city":"Singapore","days":6,"budget":"medium","clear":true}', "Singapore", 6, "medium", True),
    ('{"city":"Mumbai","days":7,"budget":"low","clear":true}', "Mumbai", 7, "low", True),
    ('{"city":"Rome","days":2,"budget":"medium","clear":true}', "Rome", 2, "medium", True),
    ('{"city":"Seoul","days":9,"budget":"high","clear":true}', "Seoul", 9, "high", True),
    ('{"city":null,"days":2,"budget":"medium","clear":false}', None, 2, "medium", False),
    ('{"city":"","days":5,"budget":"high","clear":true}', "", 5, "high", False),
    ('{"city":"Tokyo","days":0,"budget":null,"clear":true}', "Tokyo", 2, "medium", True),
    ('{"city":"Tokyo","days":null,"budget":"low","clear":true}', "Tokyo", 2, "low", True),
    ('{"city":"Tokyo","days":3,"budget":"","clear":true}', "Tokyo", 3, "medium", True),
    ('{"city":"Tokyo","days":4,"budget":"high","clear":false}', "Tokyo", 4, "high", False),
    ('{"city":"New York","days":3,"budget":"medium","clear":1}', "New York", 3, "medium", True),
    ('not json', None, 2, "medium", False),
    ('', None, 2, "medium", False),
    ('null', None, 2, "medium", False),
    ('[]', None, 2, "medium", False),
    ('{bad', None, 2, "medium", False),
    ('{"city":"Jaipur","days":1,"budget":"low","clear":true,"clarification_question":null}', "Jaipur", 1, "low", True),
    ('{"city":"Kochi","days":8,"budget":"high","clear":true,"clarification_question":"ignored"}', "Kochi", 8, "high", True),
    ('{"city":"London","days":10,"budget":"high","clear":true}', "London", 10, "high", True),
    ('{"city":"Agra","days":2,"budget":"low","clear":true}', "Agra", 2, "low", True),
    ('{"city":"Goa","days":3,"budget":"medium","clear":true}', "Goa", 3, "medium", True),
    ('{"city":"Pune","days":4,"budget":"medium","clear":true}', "Pune", 4, "medium", True),
    ('{"city":"Chennai","days":5,"budget":"high","clear":true}', "Chennai", 5, "high", True),
    ('{"city":"Bengaluru","days":6,"budget":"low","clear":true}', "Bengaluru", 6, "low", True),
]

PLAN_CASES = [
    ("1. Check weather", ["Check weather"]),
    ("1) Check weather", ["Check weather"]),
    ("- Check weather", ["Check weather"]),
    ("* Check weather", ["Check weather"]),
    ("1. Check\n2. Hotels", ["Check", "Hotels"]),
    ("1) Check\n2) Hotels", ["Check", "Hotels"]),
    ("- Check\n- Hotels", ["Check", "Hotels"]),
    ("* Check\n* Hotels", ["Check", "Hotels"]),
    ("  1.  Check weather  ", ["Check weather"]),
    ("Check weather\n\nFind hotels", ["Check weather", "Find hotels"]),
    ("1. A\n2. B\n3. C\n4. D", ["A", "B", "C", "D"]),
    ("01. A\n02. B", ["A", "B"]),
    ("10) A\n11) B", ["A", "B"]),
    ("A", ["A"]),
    ("A\n B\n  C", ["A", "B", "C"]),
    ("1.\n2.", []),
    ("\n\n", []),
    ("1. Mumbai trip\n2) Delhi trip\n- Jaipur trip", ["Mumbai trip", "Delhi trip", "Jaipur trip"]),
    ("* museums\n* food\n* culture\n* parks", ["museums", "food", "culture", "parks"]),
    ("weather\nhotels\nattractions", ["weather", "hotels", "attractions"]),
    ("1) flights\n2) hotels\n3) food", ["flights", "hotels", "food"]),
    ("- one\n- two\n- three", ["one", "two", "three"]),
    ("* one\n* two\n* three", ["one", "two", "three"]),
    ("5. Final task", ["Final task"]),
    ("A\nB\nC\nD", ["A", "B", "C", "D"]),
    (["Check weather", "Find hotels"], ["Check weather", "Find hotels"]),
    (["Find attractions"], ["Find attractions"]),
    ("1. Museums\n2. Food\n3. Parks\n4. Shopping", ["Museums", "Food", "Parks", "Shopping"]),
    ("1. A\n\n2. B\n\n3. C", ["A", "B", "C"]),
]

PREFERENCE_CASES = [
    ('[]', []),
    ('["vegetarian"]', ["vegetarian"]),
    ('["museum", "nightlife"]', ["museum", "nightlife"]),
    ('[" budget traveller "]', ["budget traveller"]),
    ('["a", "", "b"]', ["a", "b"]),
    ('["a", "  ", "b"]', ["a", "b"]),
    ('[1, "a", true]', ["a"]),
    ('{"preference":"vegetarian"}', []),
    ('null', []),
    ('"vegetarian"', []),
    ('not json', []),
    ('', []),
    ('["a", "a", "b"]', ["a", "a", "b"]),
    ('["Mumbai food", "quiet hotels", "walking"]', ["Mumbai food", "quiet hotels", "walking"]),
    ('["Hindi", "vegetarian", "family-friendly"]', ["Hindi", "vegetarian", "family-friendly"]),
    ('```json\n["museum"]\n```', ["museum"]),
    ('```["museum"]```', ["museum"]),
    ('["one", null, "two"]', ["one", "two"]),
    ('[" x ", " y "]', ["x", "y"]),
    ('[true, false, 1, 2]', []),
    ('["solo traveler"]', ["solo traveler"]),
]

@pytest.mark.parametrize("raw,city,days,budget,clear", INTENT_CASES)
def test_expanded_intent_cases(raw, city, days, budget, clear):
    result = parse_intent_json(raw)
    assert result["city"] == city
    assert result["days"] == days
    assert result["budget"] == budget
    assert result["clear"] is clear

@pytest.mark.parametrize("raw,expected", PLAN_CASES)
def test_expanded_plan_cases(raw, expected):
    assert parse_plan(raw) == expected

@pytest.mark.parametrize("raw,expected", PREFERENCE_CASES)
def test_expanded_preference_cases(raw, expected):
    assert parse_preference_json(raw) == expected


def test_parse_preference_trims_outer_whitespace():
    assert parse_preference_json('  [" museums "]  ') == ["museums"]
