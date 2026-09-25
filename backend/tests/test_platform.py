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
