from app.agent.intent import parse_intent_json
from app.agent.planner import parse_plan
from app.memory.long_term import parse_preference_json


def test_parse_intent_json_clean():
    raw = '{"city": "Tokyo", "days": 3, "budget": "low", "clear": true, "clarification_question": null}'
    result = parse_intent_json(raw)
    assert result["city"] == "Tokyo"
    assert result["days"] == 3
    assert result["clear"] is True


def test_parse_intent_json_with_markdown_fences():
    raw = '```json\n{"city": null, "days": null, "budget": null, "clear": false, "clarification_question": "Which city?"}\n```'
    result = parse_intent_json(raw)
    assert result["clear"] is False
    assert result["clarification_question"] == "Which city?"


def test_parse_intent_json_malformed_falls_back():
    result = parse_intent_json("not json at all")
    assert result["clear"] is False
    assert result["city"] is None


def test_parse_intent_clear_requires_city():
    # clear=true but no city -> should be forced to false
    raw = '{"city": null, "days": 2, "budget": "medium", "clear": true, "clarification_question": null}'
    result = parse_intent_json(raw)
    assert result["clear"] is False


def test_parse_plan_numbered_list():
    raw = "1. Check weather\n2) Find attractions\n- Estimate budget"
    result = parse_plan(raw)
    assert result == ["Check weather", "Find attractions", "Estimate budget"]


def test_parse_preference_json_list():
    raw = '["vegetarian", "loves museums", "budget traveller"]'
    result = parse_preference_json(raw)
    assert result == ["vegetarian", "loves museums", "budget traveller"]


def test_parse_preference_json_empty_on_garbage():
    assert parse_preference_json("nonsense") == []
