"""Every API test gets a freshly migrated, freshly seeded database — never the dev `dockiq.db`.

Locally that is a temp SQLite file. Set TEST_DATABASE_URL to run the same suite against Postgres
(CI does this with a service container).
"""

import asyncio
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import create_app
from app.migrate import downgrade, upgrade
from app.seed import seed


def make_settings(database_url: str) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        environment="test",
        database_url=database_url,
        nvidia_api_key=None,
        log_level="WARNING",
    )


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"
    return make_settings(url)


async def _prepare(settings: Settings, *, with_seed: bool) -> None:
    database = Database(settings)
    try:
        await downgrade(database.engine, configure_logging=False)  # a shared Postgres needs a clean slate
        await upgrade(database.engine, configure_logging=False)
        if with_seed:
            async with database.sessionmaker() as session:
                await seed(session)
    finally:
        await database.dispose()


@pytest.fixture
def empty_db(settings: Settings) -> Settings:
    asyncio.run(_prepare(settings, with_seed=False))
    return settings


@pytest.fixture
def seeded_db(settings: Settings) -> Settings:
    asyncio.run(_prepare(settings, with_seed=True))
    return settings


@pytest.fixture
def client(seeded_db: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(seeded_db)) as test_client:
        yield test_client
