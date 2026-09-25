"""The assistant: an agent that reads only what the person may see, drafts but never files, and takes
every number from a deterministic rule. See functional-specs §2.6."""

import copy
import json
from collections.abc import AsyncIterator, Callable
from types import SimpleNamespace
from typing import Any

import httpx
from fastapi.testclient import TestClient
from openai import APIConnectionError

from app.config import Settings
from app.domain.enums import Role
from app.services.agent import Agent
from app.services.agent_tools import tools_for

Login = Callable[[str], dict[str, str]]


def ask(client: TestClient, headers: dict[str, str], message: str) -> dict[str, Any]:
    response = client.post("/api/chat", json={"message": message}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


# ── Without a model: the rules-based router drives the same tools ──


def test_whats_next_shows_the_operators_own_order(client: TestClient, login: Login) -> None:
    reply = ask(client, login("OP-001"), "what's next?")
    order = next(card for card in reply["cards"] if card["kind"] == "order")
    assert order["order_number"] == "ORD-2026-4521"
    assert [line["sku"] for line in order["lines"]] == ["CRM-FZ-1001", "CRM-RF-1002"]
    assert "ORD-2026-4521" in reply["response"]
    assert reply["steps"][0]["tool"] == "my_work"


def test_a_temperature_is_judged_by_the_rule_against_the_strictest_limit(
    client: TestClient, login: Login
) -> None:
    reply = ask(client, login("OP-001"), "probe reads 12°F")
    card = next(card for card in reply["cards"] if card["kind"] == "temperature")
    # CRM-FZ-1001 is frozen (max 0°F) — stricter than the refrigerated line. See business-rules §11.1.
    assert (card["limit"], card["delta"], card["status"]) == (0.0, 12.0, "critical")
    assert "DO NOT UNLOAD" in reply["response"]


def test_where_is_a_sku_asks_the_wms(client: TestClient, login: Login) -> None:
    reply = ask(client, login("OP-001"), "where is CRM-FZ-1001?")
    stock = next(card for card in reply["cards"] if card["kind"] == "stock")
    assert stock["wms_online"] is True
    assert stock["pallets"]
    assert all("-" in pallet["location"] for pallet in stock["pallets"])


def test_the_assistant_cannot_see_another_teams_issue(client: TestClient, login: Login) -> None:
    own = client.get("/api/issues", headers=login("OP-001")).json()[0]["id"]
    reply = ask(client, login("OP-003"), f"what happened with issue #{own}?")
    assert reply["cards"] == []
    assert reply["steps"][0]["ok"] is False
    assert "that you can see" in reply["response"]


def test_supervisor_shift_summary(client: TestClient, login: Login) -> None:
    reply = ask(client, login("SUP-001"), "give me a shift summary")
    assert reply["steps"][0]["tool"] == "shift_summary"
    assert "issues in the last 12 hours" in reply["response"]


def test_a_general_question_falls_back_to_the_knowledge_base(client: TestClient, login: Login) -> None:
    reply = ask(client, login("OP-001"), "where are the slip sheets?")
    assert "Aisle 14" in reply["response"]
    assert reply["source"] == "Facility Layout Guide"


def test_tools_are_scoped_by_role() -> None:
    assert "draft_issue_report" in {tool.name for tool in tools_for(Role.OPERATOR)}
    assert "draft_broadcast" not in {tool.name for tool in tools_for(Role.OPERATOR)}
    assert {"draft_broadcast", "draft_handoff", "shift_summary"} <= {
        tool.name for tool in tools_for(Role.SUPERVISOR)
    }
    assert "draft_issue_report" not in {tool.name for tool in tools_for(Role.SUPERVISOR)}


# ── With a model: a scripted stand-in for the OpenAI-compatible endpoint ──


def _chunk(content: str | None = None, calls: list[SimpleNamespace] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=content, tool_calls=calls))]
    )


def _call(index: int, name: str, arguments: str, call_id: str) -> list[SimpleNamespace]:
    # Streamed the way servers do it: name and id first, the JSON arguments in fragments.
    half = len(arguments) // 2
    return [
        SimpleNamespace(
            index=index, id=call_id, function=SimpleNamespace(name=name, arguments=arguments[:half])
        ),
        SimpleNamespace(
            index=index, id=None, function=SimpleNamespace(name=None, arguments=arguments[half:])
        ),
    ]


class ScriptedModel:
    """Plays back one list of chunks per request and records what it was sent."""

    def __init__(self, rounds: list[list[SimpleNamespace]] | None = None, fail: bool = False) -> None:
        self.rounds = rounds or []
        self.fail = fail
        self.requests: list[dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs: Any) -> AsyncIterator[SimpleNamespace]:
        self.requests.append(copy.deepcopy(kwargs))  # the loop keeps appending to its list
        if self.fail:
            raise APIConnectionError(request=httpx.Request("POST", "https://model.invalid"))
        chunks = self.rounds[len(self.requests) - 1]

        async def stream() -> AsyncIterator[SimpleNamespace]:
            for chunk in chunks:
                yield chunk

        return stream()


def use_model(client: TestClient, model: ScriptedModel) -> None:
    settings: Settings = client.app.state.settings  # type: ignore[attr-defined]
    client.app.state.agent = Agent(settings, client=model)  # type: ignore[attr-defined, arg-type]


REPORT_ARGS = json.dumps(
    {
        "issue_type": "Damaged Pallet",
        "issue_subtype": "Crushed or collapsed pallet",
        "description": "Pallet six crushed on the left side",
        "product_sku": "CRM-FZ-1001",
        "quantity_affected": 8,
    }
)


def test_the_model_drafts_a_report_scored_by_the_formula_and_files_nothing(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    before = len(client.get("/api/issues", headers=op).json())
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "draft_issue_report", REPORT_ARGS, "call_a"))],
            [_chunk("I drafted it. **Check it and press File report.**")],
        ]
    )
    use_model(client, model)

    reply = ask(client, op, "pallet six is crushed on the left side, about eight cases of chicken")
    draft = reply["actions"][0]
    assert draft["kind"] == "file_issue"
    assert draft["payload"]["quantity_affected"] == 8
    assert "File report" in reply["response"]
    assert len(client.get("/api/issues", headers=op).json()) == before, "a draft must not be filed"

    # The preview is the formula's: filing the same payload scores identically.
    filed = client.post("/api/issues", json=draft["payload"], headers=op).json()
    assert (filed["severity"], filed["severity_score"]) == (draft["severity"], draft["severity_score"])

    # The tool result went back to the model in the second request, tied to its call id.
    tool_message = model.requests[1]["messages"][-1]
    assert (tool_message["role"], tool_message["tool_call_id"]) == ("tool", "call_a")
    assert json.loads(tool_message["content"])["severity_preview"] == draft["severity"]


def test_a_tool_the_role_may_not_use_is_refused(client: TestClient, login: Login) -> None:
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "draft_broadcast", json.dumps({"message": "Hi all"}), "call_b"))],
            [_chunk("I can't do that.")],
        ]
    )
    use_model(client, model)
    reply = ask(client, login("OP-001"), "tell everyone to take a break")
    assert reply["actions"] == []
    assert "Unknown tool" in model.requests[1]["messages"][-1]["content"]


def test_a_tool_error_goes_back_to_the_model_so_it_can_recover(client: TestClient, login: Login) -> None:
    bad = json.dumps({"issue_type": "Damaged Pallet", "issue_subtype": "Not a subtype", "description": "x"})
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "draft_issue_report", bad, "call_c"))],
            [_chunk(calls=_call(0, "draft_issue_report", REPORT_ARGS, "call_d"))],
            [_chunk("Drafted.")],
        ]
    )
    use_model(client, model)
    reply = ask(client, login("OP-001"), "crushed pallet")
    assert [step["ok"] for step in reply["steps"]] == [False, True]
    assert "issue_subtype must be one of" in model.requests[1]["messages"][-1]["content"]
    assert len(reply["actions"]) == 1


def test_if_the_model_is_unreachable_the_rules_answer(client: TestClient, login: Login) -> None:
    use_model(client, ScriptedModel(fail=True))
    reply = ask(client, login("OP-001"), "what's next?")
    assert any(card["kind"] == "order" for card in reply["cards"])


def test_stream_emits_steps_cards_text_and_done_and_keeps_history(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    with client.stream("POST", "/api/chat/stream", json={"message": "what's next?"}, headers=op) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        events = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: ")]
    kinds = [event["type"] for event in events]
    assert kinds[0] == "step"
    assert "card" in kinds
    assert "delta" in kinds
    assert kinds[-1] == "done"
    history = client.get("/api/chat/history", headers=op).json()
    assert [message["role"] for message in history] == ["user", "assistant"]
    assert history[-1]["id"] == events[-1]["message_id"]
