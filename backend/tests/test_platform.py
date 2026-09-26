"""Configuration and migrations."""

import asyncio

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.config import Settings
from app.db import Base, Database
from app.migrate import downgrade, upgrade


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        (
            "postgresql://u:p@ep-x.neon.tech/dockiq?sslmode=require&channel_binding=require",
            "postgresql+asyncpg://u:p@ep-x.neon.tech/dockiq?ssl=require",
        ),
        ("postgres://u:p@host/db", "postgresql+asyncpg://u:p@host/db"),
        ("sqlite+aiosqlite:///./x.db", "sqlite+aiosqlite:///./x.db"),
    ],
)
def test_database_url_is_normalized_for_asyncpg(given: str, expected: str) -> None:
    assert Settings(_env_file=None, database_url=given).database_url == expected  # type: ignore[call-arg]


def test_cors_origins_accept_a_comma_separated_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    assert Settings(_env_file=None).cors_origins == ["https://a.example", "https://b.example"]  # type: ignore[call-arg]


def test_migrations_match_the_models(empty_db: Settings) -> None:
    async def diff() -> list[object]:
        database = Database(empty_db)
        try:
            async with database.engine.connect() as connection:
                return await connection.run_sync(
                    lambda sync: compare_metadata(
                        MigrationContext.configure(sync, opts={"compare_type": True}), Base.metadata
                    )
                )
        finally:
            await database.dispose()

    assert asyncio.run(diff()) == []


def test_migrations_downgrade_and_reapply(empty_db: Settings) -> None:
    async def cycle() -> set[str]:
        database = Database(empty_db)
        try:
            await downgrade(database.engine, configure_logging=False)
            async with database.engine.connect() as connection:
                assert await connection.run_sync(lambda sync: inspect(sync).get_table_names()) in (
                    [],
                    ["alembic_version"],
                )
            await upgrade(database.engine, configure_logging=False)
            async with database.engine.connect() as connection:
                return set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        finally:
            await database.dispose()

    tables = asyncio.run(cycle())
    assert set(Base.metadata.tables) <= tables


def test_a_blank_key_line_means_no_key() -> None:
    from app.config import Settings

    settings = Settings(_env_file=None, nvidia_api_key="  ", demo_password="")  # type: ignore[call-arg]
    assert (settings.nvidia_api_key, settings.demo_password) == (None, None)


def test_neon_pooled_strings_are_accepted_as_neon_shows_them() -> None:
    from sqlalchemy.pool import NullPool

    from app.config import Settings
    from app.db import engine_options

    pooled = Settings(  # type: ignore[call-arg]
        _env_file=None,
        database_url="postgresql://u:p@ep-x-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    )
    assert (
        pooled.database_url
        == "postgresql+asyncpg://u:p@ep-x-pooler.c-7.us-east-2.aws.neon.tech/neondb?ssl=require"
    )
    assert pooled.behind_pgbouncer
    options = engine_options(pooled)
    assert options["poolclass"] is NullPool
    assert options["connect_args"]["statement_cache_size"] == 0

    direct = Settings(_env_file=None, database_url="postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb")  # type: ignore[call-arg]
    assert not direct.behind_pgbouncer
    assert engine_options(direct)["pool_size"] == 5


def test_the_projects_own_vercel_sites_are_allowed_without_listing_them(client: TestClient) -> None:
    def preflight(origin: str) -> str | None:
        response = client.options(
            "/api/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
        )
        return response.headers.get("access-control-allow-origin")

    assert preflight("https://dockiq.vercel.app") == "https://dockiq.vercel.app"
    assert (
        preflight("https://dockiq-git-main-someone.vercel.app")
        == "https://dockiq-git-main-someone.vercel.app"
    )
    assert preflight("https://evil.vercel.app") is None
    assert preflight("https://dockiq.vercel.app.evil.example") is None


def test_open_critical_issues_filed_before_the_rule_are_escalated_by_migration(empty_db: Settings) -> None:
    """Migration 0006 (business-rules §7.1): a critical issue never waits on the operator."""
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.models import Issue

    filed = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)

    def row(severity: str, status: str) -> dict[str, object]:
        return {
            "issue_type": "Damaged Pallet",
            "severity": severity,
            "status": status,
            "quick_tags": [],
            "recurring_patterns": [],
            "held_pallets": [],
            "estimated_cost_impact": 0,
            "simulated": False,
            "created_at": filed,
        }

    async def migrate() -> list[tuple[str, str, datetime | None]]:
        database = Database(empty_db)
        try:
            await downgrade(database.engine, configure_logging=False)
            await upgrade(database.engine, "0005", configure_logging=False)
            async with database.engine.begin() as connection:
                await connection.execute(
                    Issue.__table__.insert(),
                    [
                        row("critical", "resolution_in_progress"),
                        row("high", "resolution_in_progress"),
                        row("critical", "self_resolved"),
                    ],
                )
            await upgrade(database.engine, configure_logging=False)
            async with database.engine.connect() as connection:
                result = await connection.execute(
                    select(Issue.severity, Issue.status, Issue.escalated_at).order_by(Issue.id)
                )
                return [(r.severity.value, r.status.value, r.escalated_at) for r in result]
        finally:
            await database.dispose()

    assert asyncio.run(migrate()) == [
        ("critical", "escalated", filed),
        ("high", "resolution_in_progress", None),
        ("critical", "self_resolved", None),  # closed history is left as it was
    ]


def test_recurring_pattern_ordinals_stored_before_the_fix_are_corrected_by_migration(
    empty_db: Settings,
) -> None:
    """Migration 0007 (business-rules §6): stored messages read as English ordinals."""
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.models import Issue

    def message(count: str) -> str:
        return f"This is the {count} 'Damaged Pallet' at Dock 4 in the last 7 days. Possible root cause: …"

    def row(patterns: list[dict[str, object]]) -> dict[str, object]:
        return {
            "issue_type": "Damaged Pallet",
            "severity": "medium",
            "status": "resolution_in_progress",
            "quick_tags": [],
            "recurring_patterns": patterns,
            "held_pallets": [],
            "estimated_cost_impact": 0,
            "simulated": False,
            "created_at": datetime(2026, 9, 1, 8, 0, tzinfo=UTC),
        }

    stored = [
        [{"type": "dock", "message": message("3th"), "count": 3}],
        [
            {"type": "dock", "message": message("1th"), "count": 1},
            {"type": "carrier", "message": message("2th").replace("at Dock 4", "from Polar"), "count": 2},
        ],
        [{"type": "dock", "message": message("11st"), "count": 11}],
        [{"type": "dock", "message": message("21th"), "count": 21}],
        [{"type": "dock", "message": message("4th"), "count": 4}],  # already right: unchanged
        [],
    ]

    async def migrate() -> list[list[str]]:
        database = Database(empty_db)
        try:
            await downgrade(database.engine, configure_logging=False)
            await upgrade(database.engine, "0006", configure_logging=False)
            async with database.engine.begin() as connection:
                await connection.execute(Issue.__table__.insert(), [row(p) for p in stored])
            await upgrade(database.engine, configure_logging=False)
            async with database.engine.connect() as connection:
                result = await connection.execute(select(Issue.recurring_patterns).order_by(Issue.id))
                return [[p["message"].split(" '")[0] for p in patterns] for (patterns,) in result]
        finally:
            await database.dispose()

    assert asyncio.run(migrate()) == [
        ["This is the 3rd"],
        ["This is the 1st", "This is the 2nd"],
        ["This is the 11th"],
        ["This is the 21st"],
        ["This is the 4th"],
        [],
    ]
