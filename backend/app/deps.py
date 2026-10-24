from collections.abc import Callable

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.crud import Forbidden, Unauthorized
from app.db import get_db
from app.resources.users.models import User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False, description="Token from POST /api/auth/login")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise Unauthorized("Please sign in to continue")
    user_id = decode_access_token(credentials.credentials)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:
        raise Unauthorized("Your session has expired. Please sign in again")
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    """Dependency for plain (non generated) routes: only the listed roles get through."""

    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise Forbidden("You do not have permission to do this")
        return user

    return guard
