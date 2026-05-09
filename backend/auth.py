"""JWT authentication utilities for Wayly."""
import os
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

JWT_SECRET = os.environ.get("JWT_SECRET", "wayly-dev-secret-change-me")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24 * 30  # 30 days

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user_id(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_token(creds.credentials)
