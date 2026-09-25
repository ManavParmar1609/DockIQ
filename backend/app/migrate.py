"""Run Alembic programmatically against an async engine (used by the seed CLI and the tests)."""

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import BACKEND_DIR


def alembic_config(*, configure_logging: bool = True) -> Config:
    config = Config(toml_file=BACKEND_DIR / "pyproject.toml")
    config.attributes["configure_logging"] = configure_logging
    return config


def _run(connection: Connection, config: Config, action: str, revision: str) -> None:
    config.attributes["connection"] = connection
    getattr(command, action)(config, revision)


async def upgrade(engine: AsyncEngine, revision: str = "head", *, configure_logging: bool = True) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(
            _run, alembic_config(configure_logging=configure_logging), "upgrade", revision
        )


async def downgrade(engine: AsyncEngine, revision: str = "base", *, configure_logging: bool = True) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(
            _run, alembic_config(configure_logging=configure_logging), "downgrade", revision
        )
