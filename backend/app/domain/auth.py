from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crud import ErrorResponse, Unauthorized
from app.db import get_db
from app.deps import get_current_user
from app.ratelimit import login_limiter
from app.resources.users.models import User
from app.resources.users.schemas import Email, UserRead
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["Auth"])

# Checked when the email is unknown, so both failures take about the same time.
_DUMMY_HASH = hash_password("not-a-real-password")


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: Email
    password: str = Field(min_length=8, max_length=128)
    role: Literal["student", "faculty"] = "student"
    department: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


@router.post(
    "/register", response_model=TokenResponse, status_code=201, summary="Create an account",
    responses={409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Public signup creates only student or faculty accounts. An admin promotes others."""
    user = User(
        name=payload.name.strip(),
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        department=payload.department,
    )
    db.add(user)
    db.flush()
    db.refresh(user)
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id), user=UserRead.model_validate(user))


@router.post(
    "/login", response_model=TokenResponse, summary="Sign in",
    responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client = request.client.host if request.client else "unknown"
    if not login_limiter.allow(client):
        raise HTTPException(429, "Too many sign in attempts. Try again in a minute", headers={"Retry-After": "60"})
    user = db.scalars(select(User).where(User.email == payload.email)).first()
    valid = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not valid:
        raise Unauthorized("Incorrect email or password")
    return TokenResponse(access_token=create_access_token(user.id), user=UserRead.model_validate(user))


@router.get(
    "/me", response_model=UserRead, summary="Current user",
    responses={401: {"model": ErrorResponse}},
)
def me(user: User = Depends(get_current_user)):
    return user
