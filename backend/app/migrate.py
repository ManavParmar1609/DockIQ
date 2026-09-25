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


async def _migrate(engine: AsyncEngine, action: str, revision: str, configure_logging: bool) -> None:
    config = alembic_config(configure_logging=configure_logging)
    async with engine.connect() as connection:
        sqlite = connection.dialect.name == "sqlite"
        if sqlite:
            # Batch migrations rebuild tables (copy, drop, rename). With enforcement on, dropping a
            # referenced table fails, so it is paused for the migration and verified afterwards.
            # The pragma is ignored inside a transaction, hence the commit before and after.
            await connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            await connection.commit()
        await connection.run_sync(_run, config, action, revision)
        await connection.commit()
        if sqlite:
            violations = (await connection.exec_driver_sql("PRAGMA foreign_key_check")).fetchall()
            await connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            await connection.commit()
            if violations:
                raise RuntimeError(f"migration left foreign-key violations: {violations[:5]}")


async def upgrade(engine: AsyncEngine, revision: str = "head", *, configure_logging: bool = True) -> None:
    await _migrate(engine, "upgrade", revision, configure_logging)


async def downgrade(engine: AsyncEngine, revision: str = "base", *, configure_logging: bool = True) -> None:
    await _migrate(engine, "downgrade", revision, configure_logging)
