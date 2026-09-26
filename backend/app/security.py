"""Password hashing (Argon2 via pwdlib) and signed access tokens (HS256 JWT via PyJWT)."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from pwdlib import PasswordHash

from app.config import Settings
from app.db import utcnow
from app.domain.enums import Role

ALGORITHM = "HS256"

_hasher = PasswordHash.recommended()
# Verified against when the account does not exist, so a miss costs the same time as a hit.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


@lru_cache(maxsize=4)
def demo_password_hash(password: str) -> str:
    """Seeding hashes the shared demo password once per process, not once per account."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    return _hasher.verify(password, password_hash)


@dataclass(frozen=True, slots=True)
class TokenClaims:
    user_id: int
    role: Role
    expires_at: datetime  # the token's `exp`: a WebSocket opened with it is closed then


def create_access_token(settings: Settings, user_id: int, role: Role) -> str:
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role.value,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm=ALGORITHM)


def decode_access_token(settings: Settings, token: str) -> TokenClaims | None:
    """None for any invalid, expired or malformed token — callers never see why."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[ALGORITHM],
            options={"require": ["sub", "exp", "role"]},
        )
        return TokenClaims(
            user_id=int(payload["sub"]),
            role=Role(payload["role"]),
            expires_at=datetime.fromtimestamp(int(payload["exp"]), UTC),
        )
    except (jwt.InvalidTokenError, ValueError, KeyError, TypeError, OverflowError):
        return None
