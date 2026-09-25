"""Alembic environment. The database URL comes from app settings (DATABASE_URL), never from config.

Programmatic callers (tests, `python -m app.seed`) may pass an open connection via
`config.attributes["connection"]`.
"""

import asyncio
import logging

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.config import get_settings
from app.db import Base

config = context.config
target_metadata = Base.metadata

if config.attributes.get("configure_logging", True):
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _configure(**kwargs: object) -> None:
    context.configure(
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite needs table rebuilds for ALTER
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(url=get_settings().database_url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(get_settings().database_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is None:
        asyncio.run(run_async_migrations())
    else:
        do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
