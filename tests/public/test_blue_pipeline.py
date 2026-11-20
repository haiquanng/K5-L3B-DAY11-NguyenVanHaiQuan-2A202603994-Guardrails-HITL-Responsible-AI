"""Blue runner regressions that do not require provider credentials."""
import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

from agents.agent import create_blue_agent
from assignment.pipeline import build_production_plugins
from assignment.rate_limiter import RateLimitPlugin
from guardrails.output_guardrails import content_filter, load_lab_pii_dataset


def test_all_lab_pii_categories():
    for case in load_lab_pii_dataset()["pii_cases"]:
        result = content_filter(case["input_text"])
        assert result["safe"] == case["expect_safe"], case["id"]
        assert set(result["issues"]) == set(case["expect_issue_types"]), case["id"]


def test_limiter_expires_at_window_boundary(monkeypatch):
    limiter = RateLimitPlugin(max_requests=1, window_seconds=60)
    ctx = SimpleNamespace(user_id="customer")
    clock = Mock(side_effect=[100.0, 159.99, 160.0])
    monkeypatch.setattr("assignment.rate_limiter.time", SimpleNamespace(monotonic=clock))

    async def burst():
        return [await limiter.on_user_message_callback(invocation_context=ctx, user_message=None)
                for _ in range(3)]

    first, second, third = asyncio.run(burst())
    assert first is None and second is not None and third is None


def test_runner_reports_redaction_and_isolates_users(monkeypatch):
    agent, runner = create_blue_agent(build_production_plugins(max_requests=1))
    client = Mock()
    client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="Mail a@b.example"))]
    )
    monkeypatch.setattr(runner, "_client", lambda: client)

    async def chat(user):
        return await runner.chat_with_decision(agent, "Check account balance", user_id=user)

    assert asyncio.run(chat("first")) == ("Mail [REDACTED]", "output_guardrail")
    assert asyncio.run(chat("first"))[1] == "rate_limiter"
    assert asyncio.run(chat("second")) == ("Mail [REDACTED]", "output_guardrail")
    assert client.chat.completions.create.call_count == 2
