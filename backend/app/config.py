from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_URL = f"sqlite+aiosqlite:///{(BACKEND_DIR / 'dev.db').as_posix()}"


class Settings(BaseSettings):
    """Runtime configuration, read from the environment (and `backend/.env` if present)."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # Local development defaults to a SQLite file; production points at Neon Postgres.
    database_url: str = DEFAULT_SQLITE_URL

    # Comma-separated in the environment: CORS_ORIGINS=https://a.vercel.app,https://b.example
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    nvidia_api_key: SecretStr | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model: str = "meta/llama-3.1-70b-instruct"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, value: str) -> str:
        """Accept the plain `postgresql://…?sslmode=require` string Neon hands out."""
        url = make_url(value)
        if url.get_backend_name() in ("postgres", "postgresql"):
            url = url.set(drivername="postgresql+asyncpg")
            # asyncpg spells it `ssl` and rejects libpq-only parameters.
            query = dict(url.query)
            sslmode = query.pop("sslmode", None)
            query.pop("channel_binding", None)
            if sslmode and "ssl" not in query:
                query["ssl"] = sslmode
            url = url.set(query=query)
        return url.render_as_string(hide_password=False)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
