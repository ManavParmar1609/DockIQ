from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-do-not-deploy"  # noqa: S105 — rejected in production
DEV_DEMO_PASSWORD = "dockiq-demo"  # noqa: S105 — development default, documented in the README
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

    # Signs access tokens. Production must set a long random value (see docs/deployment.md).
    jwt_secret: SecretStr = SecretStr(DEV_JWT_SECRET)
    access_token_minutes: int = 12 * 60  # one shift

    # Password given to seeded demo accounts. Development falls back to DEV_DEMO_PASSWORD;
    # production seeds no passwords unless this is set.
    demo_password: SecretStr | None = None
    # Public list of demo accounts (names and employee IDs only) on the login screen.
    demo_accounts_listed: bool = True

    # The warehouse system behind the WmsClient boundary. "simulated" runs the live shift simulator;
    # "none" means no WMS is connected. A real WMS adapter would add a mode here.
    wms_mode: Literal["simulated", "none"] = "simulated"
    # How often the simulator catches up with its clock. 0 disables the background tick (tests drive
    # it explicitly); correctness never depends on it, only timeliness.
    sim_tick_seconds: float = 2.0

    nvidia_api_key: SecretStr | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model: str = "nvidia/nemotron-3-ultra-550b-a55b"
    # Reasoning mode (slower, sometimes better tool choices). The reasoning itself is never shown.
    nvidia_thinking: bool = False

    @field_validator("nvidia_api_key", "demo_password", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        """`NVIDIA_API_KEY=` with nothing after it means "no key", not an empty key."""
        return None if isinstance(value, str) and not value.strip() else value

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

    @model_validator(mode="after")
    def _production_secrets(self) -> "Settings":
        if self.environment == "production":
            secret = self.jwt_secret.get_secret_value()
            if secret == DEV_JWT_SECRET or len(secret) < 32:
                raise ValueError("JWT_SECRET must be set to a random value of 32+ characters in production")
        return self

    @property
    def effective_demo_password(self) -> str | None:
        if self.demo_password is not None:
            return self.demo_password.get_secret_value()
        return None if self.environment == "production" else DEV_DEMO_PASSWORD

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def behind_pgbouncer(self) -> bool:
        """Neon's pooled endpoint (host `ep-…-pooler…`) is PgBouncer in transaction mode."""
        return "-pooler." in (make_url(self.database_url).host or "")


@lru_cache
def get_settings() -> Settings:
    return Settings()
