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
