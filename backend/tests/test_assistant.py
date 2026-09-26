"""The assistant: an agent that reads only what the person may see, drafts but never files, and takes
every number from a deterministic rule. See functional-specs §2.6."""

import copy
import dataclasses
import json
from collections.abc import AsyncIterator, Callable
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError
from sqlalchemy import text

from app.config import Settings
from app.domain.enums import Role
from app.services import agent_tools
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
    assert "DO NOT LOAD" in reply["response"]  # OP-001 is loading: the guidance follows the direction


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
    kinds = [event["type"] for event in events if event["type"] != "source"]
    assert events[0] == {
        "type": "source",
        "source": "DockIQ assistant (rules + your data)",
        "confidence": "high",
    }
    assert kinds[0] == "step"
    assert "card" in kinds
    assert "delta" in kinds
    assert kinds[-1] == "done"
    history = client.get("/api/chat/history", headers=op).json()
    assert [message["role"] for message in history] == ["user", "assistant"]
    assert history[-1]["id"] == events[-1]["message_id"]


def test_durations_reach_the_model_the_way_a_person_says_them() -> None:
    from app.services.agent_tools import open_for

    assert (open_for(1), open_for(45), open_for(180), open_for(40_440)) == (
        "1 minute",
        "45 minutes",
        "3 hours",
        "28 days",
    )


def test_a_fallback_answer_is_labelled_as_rules_not_model(client: TestClient, login: Login) -> None:
    use_model(client, ScriptedModel(fail=True))
    reply = ask(client, login("OP-001"), "what's next?")
    assert reply["source"] == "DockIQ assistant (rules + your data)"


def test_a_model_that_fails_after_a_tool_answers_from_that_tool(client: TestClient, login: Login) -> None:
    class FailsSecondTime(ScriptedModel):
        async def _create(self, **kwargs: Any) -> AsyncIterator[SimpleNamespace]:
            if self.requests:
                self.fail = True
            return await super()._create(**kwargs)

    model = FailsSecondTime([[_chunk(calls=_call(0, "my_work", "{}", "call_w"))]])
    use_model(client, model)
    reply = ask(client, login("OP-001"), "what's next?")
    assert [step["tool"] for step in reply["steps"]] == ["my_work"], "the tool must not run twice"
    assert [card["kind"] for card in reply["cards"]].count("order") == 1
    assert "ORD-2026-4521" in reply["response"]
    assert reply["source"] == "DockIQ assistant (rules + your data)"


def test_an_unexpected_tool_failure_is_a_failed_step_and_the_conversation_goes_on(
    client: TestClient, login: Login, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(ctx: agent_tools.ToolContext, _: dict[str, Any]) -> agent_tools.ToolOutcome:
        await ctx.session.execute(text("SELECT * FROM no_such_table"))  # poisons the transaction
        raise AssertionError("unreachable")

    patched = tuple(
        dataclasses.replace(tool, handler=broken) if tool.name == "shift_summary" else tool
        for tool in agent_tools.TOOLS
    )
    monkeypatch.setattr(agent_tools, "TOOLS", patched)
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "shift_summary", "{}", "call_s"))],
            [_chunk(calls=_call(0, "my_work", "{}", "call_m"))],  # the session still works afterwards
            [_chunk("Summary is unavailable; here is your queue.")],
        ]
    )
    use_model(client, model)
    sup = login("SUP-001")
    reply = ask(client, sup, "how is the shift going?")
    assert [(step["tool"], step["ok"]) for step in reply["steps"]] == [
        ("shift_summary", False),
        ("my_work", True),
    ]
    assert "error" in json.loads(model.requests[1]["messages"][-1]["content"])
    assert reply["response"] == "Summary is unavailable; here is your queue."
    assert [m["role"] for m in client.get("/api/chat/history", headers=sup).json()] == ["user", "assistant"]


def test_a_record_number_beyond_the_database_integer_is_not_looked_up(
    client: TestClient, login: Login
) -> None:
    reply = ask(client, login("OP-001"), f"what about issue #{2**31}?")
    assert [step["ok"] for step in reply["steps"]] == [False]
    assert reply["response"] == "An issue reference is its number, like 42"


def test_non_finite_or_oversized_numbers_are_refused_by_the_tools(client: TestClient, login: Login) -> None:
    draft = {"issue_type": "Temperature Deviation", "description": "warm load"}
    model = ScriptedModel(
        [
            [
                _chunk(
                    calls=_call(0, "draft_issue_report", json.dumps({**draft, "temp_reading_f": "nan"}), "c1")
                )
            ],
            [
                _chunk(
                    calls=_call(0, "draft_issue_report", json.dumps({**draft, "count_actual": 2**40}), "c2")
                )
            ],
            [_chunk(calls=_call(0, "check_temperature", json.dumps({"reading_f": "inf"}), "c3"))],
            [_chunk("I need real numbers.")],
        ]
    )
    use_model(client, model)
    reply = ask(client, login("OP-001"), "the load is warm")
    assert [step["ok"] for step in reply["steps"]] == [False, False, False]
    assert reply["actions"] == []


# ── Procedures: direction, band, and never extended — business-rules §3, functional-specs §2.6 ──


def tool_result(model: ScriptedModel, request: int = 1) -> dict[str, Any]:
    """What the tool returned to the model, as the model read it in its next request."""
    return json.loads(model.requests[request]["messages"][-1]["content"])


def procedure_titles(reply: dict[str, Any]) -> list[str]:
    return [card["title"] for card in reply["cards"] if card["kind"] == "procedure"]


def test_a_loading_job_gets_the_loading_procedure(client: TestClient, login: Login) -> None:
    # OP-001 is loading ORD-2026-4521 (outbound): no "continue unloading", no "partial accept".
    args = json.dumps({"issue_type": "Damaged Pallet", "description": "two cases crushed"})
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "find_procedure", args, "p1"))],
            [_chunk("Steps above.")],
        ]
    )
    use_model(client, model)
    reply = ask(client, login("OP-001"), "two cases are crushed, what do I do?")
    assert procedure_titles(reply) == ["Damaged cases found while loading"]
    steps = next(card for card in reply["cards"] if card["kind"] == "procedure")["steps"]
    assert not any("unloading" in step.lower() or "partial accept" in step.lower() for step in steps)
    result = tool_result(model)
    assert result["direction"] == "loading (outbound)"
    assert "word for word" in result["how_to_answer"]


def test_without_a_reading_both_temperature_procedures_come_back_labelled(
    client: TestClient, login: Login
) -> None:
    args = json.dumps({"issue_type": "Temperature Deviation", "description": "the chicken feels warm"})
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "find_procedure", args, "t1"))],
            [_chunk("Which reading?")],
        ]
    )
    use_model(client, model)
    reply = ask(client, login("OP-001"), "the chicken feels warm")
    assert procedure_titles(reply) == [
        "Product within 5°F of its limit while loading (marginal)",
        "Product more than 5°F above its limit while loading",
    ]
    result = tool_result(model)
    assert [p["applies_when"] for p in result["procedures"]] == [
        "reading 0–5°F over the product's limit",
        "reading more than 5°F over the product's limit",
    ]


def test_a_reading_picks_one_temperature_procedure(client: TestClient, login: Login) -> None:
    # CRM-FZ-1001's limit is 0°F: 3°F is 3° over, the marginal band (business-rules §3.2).
    args = json.dumps({"issue_type": "Temperature Deviation", "description": "probe", "reading_f": 3})
    model = ScriptedModel([[_chunk(calls=_call(0, "find_procedure", args, "t2"))], [_chunk("Re-probe.")]])
    use_model(client, model)
    reply = ask(client, login("OP-001"), "probe says 3")
    assert procedure_titles(reply) == ["Product within 5°F of its limit while loading (marginal)"]
    assert tool_result(model)["reading_over_limit_f"] == 3.0


def test_a_weak_match_is_flagged_so_the_model_adds_nothing(client: TestClient, login: Login) -> None:
    args = json.dumps({"issue_type": "Equipment Failure", "description": "zzz"})
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "find_procedure", args, "w1"))],
            [_chunk("Weak match.")],
        ]
    )
    use_model(client, model)
    ask(client, login("SUP-001"), "zzz")
    assert tool_result(model)["note"] == agent_tools.LOW_MATCH_NOTE


def system_text(client: TestClient, headers: dict[str, str]) -> str:
    model = ScriptedModel([[_chunk("Hello.")]])
    use_model(client, model)
    ask(client, headers, "hello")
    return str(model.requests[0]["messages"][0]["content"])


def test_the_prompt_forbids_extending_a_procedure(client: TestClient, login: Login) -> None:
    prompt = system_text(client, login("OP-001"))
    assert "word for word" in prompt
    assert "Never add, merge, reword or generalise a step" in prompt


def test_the_prompt_speaks_to_each_role(client: TestClient, login: Login) -> None:
    operator = system_text(client, login("OP-001"))
    assert "**Stop and call your supervisor now.**" in operator
    supervisor = system_text(client, login("SUP-001"))
    assert "your supervisor" not in supervisor
    assert "Never tell them to confirm with, wait for or call a supervisor" in supervisor
    quality = system_text(client, login("QA-001"))
    assert "your supervisor" not in quality
    assert "stand by for supervisor" not in quality
    assert all(word in quality for word in ("holds", "disposition", "traceability"))


# ── Self-resolve through the assistant: a draft the worker confirms — business-rules §7.1 ──

MINOR = {
    "order_id": 1,
    "dock_door_id": 1,
    "issue_type": "Barcode Issue",
    "issue_subtype": "Barcode will not scan",
    "description": "label smudged",
    "company_id": 1,
    "carrier_id": 1,
}
CRITICAL = {
    "order_id": 1,
    "dock_door_id": 1,
    "issue_type": "Temperature Deviation",
    "issue_subtype": "Product temperature out of range",
    "description": "probe reads 20F",
    "product_id": 1,
    "company_id": 1,
    "carrier_id": 1,
    "temp_reading": 20.0,
    "temp_threshold_max": 0.0,
}


def file(client: TestClient, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/issues", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def clear_open_issues(client: TestClient, headers: dict[str, str]) -> None:
    """Close the seeded open issues the operator may close, so a test starts from a known queue."""
    for issue in client.get("/api/issues?limit=200", headers=headers).json():
        if issue["can_self_resolve"]:
            client.put(
                f"/api/issues/{issue['id']}/self-resolve",
                json={"resolution_type": "Other", "resolution_notes": "setup"},
                headers=headers,
            )


def test_close_issue_drafts_a_resolution_and_changes_nothing_until_confirmed(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    issue = file(client, op, MINOR)
    assert issue["severity"] != "critical"
    reply = ask(client, op, f"close issue {issue['id']}, I did a manual entry")
    assert [step["tool"] for step in reply["steps"]] == [
        "my_open_issues",
        "draft_self_resolve",
    ]
    draft = reply["actions"][0]
    assert (draft["kind"], draft["issue_id"], draft["resolution_type"]) == (
        "self_resolve",
        issue["id"],
        "Manual Entry",
    )
    assert draft["title"] == "Barcode will not scan"
    assert f"Resolve issue #{issue['id']}" in reply["response"]
    # The assistant wrote nothing (security.md §4): still open until the worker confirms.
    assert client.get(f"/api/issues/{issue['id']}", headers=op).json()["status"] == "resolution_in_progress"

    # Confirming is the ordinary endpoint, called with the draft's values.
    confirmed = client.put(
        f"/api/issues/{issue['id']}/self-resolve",
        json={
            "resolution_type": draft["resolution_type"],
            "resolution_notes": draft["resolution_notes"],
        },
        headers=op,
    )
    assert confirmed.status_code == 200, confirmed.text
    assert client.get(f"/api/issues/{issue['id']}", headers=op).json()["status"] == "self_resolved"


def test_a_critical_issue_is_the_supervisors_decision_with_nothing_to_confirm(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    issue = file(client, op, CRITICAL)
    assert issue["severity"] == "critical"
    reply = ask(client, op, f"close issue {issue['id']}")
    assert reply["actions"] == []
    assert "supervisor decides" in reply["response"]
    assert "nothing for you to confirm" in reply["response"]


def test_an_escalated_issue_is_drafted_with_the_workers_note_required(
    client: TestClient, login: Login
) -> None:
    """business-rules §7.5: escalated but not critical, the worker may close it with their own note."""
    op = login("OP-001")
    issue = file(client, op, MINOR)
    assert client.put(f"/api/issues/{issue['id']}/escalate", headers=op).status_code == 200
    reply = ask(client, op, f"close issue {issue['id']}")
    [draft] = reply["actions"]
    assert (draft["kind"], draft["issue_id"], draft["note_required"]) == ("self_resolve", issue["id"], True)
    assert draft["resolution_notes"] == ""  # never a stock phrase standing in for the worker's words
    assert "Write what you did in the note" in reply["response"]
    assert client.get(f"/api/issues/{issue['id']}", headers=op).json()["status"] == "escalated"


def test_my_open_issues_marks_an_escalated_issue_note_required(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    minor = file(client, op, MINOR)
    client.put(f"/api/issues/{minor['id']}/escalate", headers=op)
    model = ScriptedModel([[_chunk(calls=_call(0, "my_open_issues", "{}", "o1"))], [_chunk("Here.")]])
    use_model(client, model)
    ask(client, op, "resolve my issue")
    listed = {issue["id"]: issue for issue in tool_result(model)["open_issues"]}
    assert (listed[minor["id"]]["can_self_resolve"], listed[minor["id"]]["note_required"]) == (True, True)


def test_i_fixed_it_drafts_the_one_issue_the_worker_may_close(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    clear_open_issues(client, op)
    minor, critical = file(client, op, MINOR), file(client, op, CRITICAL)
    reply = ask(client, op, "I fixed it")
    assert [action["issue_id"] for action in reply["actions"]] == [minor["id"]]
    assert reply["actions"][0]["resolution_type"] is None  # the worker picks what they did
    assert "Pick what you did" in reply["response"]
    assert critical["id"] not in [action["issue_id"] for action in reply["actions"]]


def test_my_open_issues_says_which_the_worker_may_close(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    minor, critical = file(client, op, MINOR), file(client, op, CRITICAL)
    model = ScriptedModel([[_chunk(calls=_call(0, "my_open_issues", "{}", "o1"))], [_chunk("Here.")]])
    use_model(client, model)
    ask(client, op, "resolve my issue")
    listed = {issue["id"]: issue for issue in tool_result(model)["open_issues"]}
    assert listed[minor["id"]]["can_self_resolve"] is True
    assert listed[critical["id"]]["can_self_resolve"] is False
    assert "supervisor decides" in listed[critical["id"]]["why_not"]
    assert "Manual Entry" in tool_result(model)["resolution_options"]


def test_a_model_cannot_draft_an_unknown_resolution(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue = file(client, op, MINOR)
    bad = json.dumps({"issue_id": issue["id"], "resolution_type": "Threw it away"})
    model = ScriptedModel([[_chunk(calls=_call(0, "draft_self_resolve", bad, "r1"))], [_chunk("No.")]])
    use_model(client, model)
    reply = ask(client, op, "close it")
    assert reply["actions"] == []
    assert "resolution_type must be one of" in model.requests[1]["messages"][-1]["content"]


def test_self_resolve_is_for_operators_and_the_wms_tools_for_staff() -> None:
    operator = {tool.name for tool in tools_for(Role.OPERATOR)}
    assert {"my_open_issues", "draft_self_resolve"} <= operator
    assert not {"room_status", "trace_lot"} & operator
    for role in (Role.SUPERVISOR, Role.QUALITY):
        staff = {tool.name for tool in tools_for(role)}
        assert {"room_status", "trace_lot"} <= staff
        assert not {"my_open_issues", "draft_self_resolve"} & staff


# ── Severity in a draft is the formula's, proportional to the cases — business-rules §1.9 ──


def test_two_torn_cases_draft_scores_by_share_and_files_the_same(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    args = json.dumps(
        {
            "issue_type": "Damaged Pallet",
            "issue_subtype": "Damaged cartons or packaging",
            "description": "two torn cases of chicken",
            "product_sku": "CRM-FZ-1001",
            "quantity_affected": 2,
        }
    )
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "draft_issue_report", args, "d1"))],
            [_chunk("Drafted.")],
        ]
    )
    use_model(client, model)
    draft = ask(client, op, "two torn cases of chicken")["actions"][0]
    # 4 × 3.0 × 1.5 = 18 × 0.4 (2 of a 48-case pallet) = 7.2, + 2 dwell = 9.2 → MEDIUM (was 20.0 critical)
    assert (draft["severity"], draft["severity_score"]) == ("medium", 9.2)
    filed = file(client, op, draft["payload"])
    assert (filed["severity"], filed["severity_score"]) == ("medium", 9.2)


def test_a_draft_without_a_case_count_is_not_scaled(client: TestClient, login: Login) -> None:
    args = json.dumps(
        {
            "issue_type": "Damaged Pallet",
            "issue_subtype": "Damaged cartons or packaging",
            "description": "torn cases",
            "product_sku": "CRM-FZ-1001",
        }
    )
    model = ScriptedModel(
        [
            [_chunk(calls=_call(0, "draft_issue_report", args, "d2"))],
            [_chunk("Drafted.")],
        ]
    )
    use_model(client, model)
    draft = ask(client, login("OP-001"), "torn cases")["actions"][0]
    assert draft["payload"]["quantity_affected"] is None
    assert (draft["severity"], draft["severity_score"]) == ("critical", 20.0)


# ── Quality and supervisors: cold rooms and lot trace through the WMS ──


def test_freezer_temperature_reads_the_rooms_from_the_wms(client: TestClient, login: Login) -> None:
    reply = ask(client, login("QA-001"), "what's the freezer temp?")
    assert reply["steps"][0]["tool"] == "room_status"
    card = next(card for card in reply["cards"] if card["kind"] == "rooms")
    assert [room["name"] for room in card["rooms"]] == ["Freezer"]
    assert card["rooms"][0]["limit"] == 0.0
    assert card["simulated"] is True


def test_trace_lot_follows_a_sku_and_one_lot(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    reply = ask(client, sup, "trace CRM-FZ-1001")
    card = next(card for card in reply["cards"] if card["kind"] == "trace")
    assert card["on_hand"]
    lot = card["on_hand"][0]["lot"]
    one = ask(client, sup, f"trace CRM-FZ-1001 lot {lot}")
    traced = next(card for card in one["cards"] if card["kind"] == "trace")
    assert traced["lot"] == lot
    assert traced["on_hand"]
    assert {pallet["lot"] for pallet in traced["on_hand"]} == {lot}
    assert len(traced["on_hand"]) <= agent_tools.MAX_LIST


def test_an_operator_asking_to_trace_gets_no_wms_trace(client: TestClient, login: Login) -> None:
    reply = ask(client, login("OP-001"), "trace CRM-FZ-1001")
    assert not any(step["tool"] == "trace_lot" for step in reply["steps"])
