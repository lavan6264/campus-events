import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL.match(value) or len(value) > 255:
        raise ValueError("Enter a valid email address")
    return value


# Plain format check instead of EmailStr, which rejects the .test demo domain.
Email = Annotated[str, AfterValidator(_clean_email)]
Role = Literal["student", "faculty", "admin"]


class UserRead(BaseModel):
    """Public view of a user. The password hash is never part of any response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    role: Role
    department: str | None
    created_at: datetime


class UserCreate(BaseModel):
    """Admin creates an account, including any role."""

    name: str = Field(min_length=1, max_length=120)
    email: Email
    password: str = Field(min_length=8, max_length=128)
    role: Role = "student"
    department: str | None = Field(default=None, max_length=120)


class UserUpdate(BaseModel):
    """Profile fields only. There is deliberately no `role` here: roles change through
    PATCH /admin/users/{id}/role, so a role sent in this body is ignored."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: Email | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    department: str | None = Field(default=None, max_length=120)
