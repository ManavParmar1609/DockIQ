from collections.abc import AsyncIterator
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import uuid4

from fastapi import Request
from sqlalchemy import DateTime, Enum, event
from sqlalchemy.engine import Dialect
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from sqlalchemy.types import TypeDecorator

from app.config import Settings

# Primary keys are Postgres INTEGER: a larger bind fails in the driver (a 500), so inputs stop here.
MAX_ID = 2**31 - 1


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC everywhere. Postgres stores timestamptz; SQLite stores naive UTC."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime passed to UTCDateTime")
        value = value.astimezone(UTC)
        return value.replace(tzinfo=None) if dialect.name == "sqlite" else value

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def enum_column(enum_cls: type[StrEnum]) -> Enum:
    """A portable VARCHAR holding the enum's *values*. The CHECK constraint lives in the migration."""
    return Enum(
        enum_cls,
        native_enum=False,
        create_constraint=False,
        length=32,
        values_callable=lambda e: [member.value for member in e],
        name=enum_cls.__name__.lower(),
        validate_strings=True,
    )


NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    pass


Base.metadata.naming_convention = NAMING_CONVENTION


def engine_options(settings: Settings) -> dict[str, Any]:
    if settings.is_sqlite:
        return {"pool_pre_ping": True}
    if settings.behind_pgbouncer:
        # PgBouncer pools for us and may hand each transaction a different server connection, so
        # asyncpg's numbered, cached prepared statements would collide. SQLAlchemy's documented
        # remedy: no client pool, unique statement names, no statement cache.
        return {
            "poolclass": NullPool,
            "connect_args": {
                "statement_cache_size": 0,
                "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
            },
        }
    # Direct connection. Neon closes idle connections when the compute scales to zero.
    return {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 5, "pool_recycle": 300}


def create_engine(settings: Settings) -> AsyncEngine:
    # hide_parameters: a failed statement's log line must not carry what a person typed.
    engine = create_async_engine(settings.database_url, hide_parameters=True, **engine_options(settings))
    if settings.is_sqlite:
        event.listen(engine.sync_engine, "connect", _sqlite_pragmas)
    return engine


def _sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


class Database:
    def __init__(self, settings: Settings) -> None:
        self.engine = create_engine(settings)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)

    async def dispose(self) -> None:
        await self.engine.dispose()


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request. Uncommitted work is rolled back when the block exits."""
    database: Database = request.app.state.db
    async with database.sessionmaker() as session:
        yield session
