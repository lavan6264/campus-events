from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class RegistrationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    user_id: int
    status: Literal["registered", "waitlisted", "cancelled"]
    created_at: datetime
    updated_at: datetime
    event_title: str | None = None
    user_name: str | None = None


class RegistrationCreate(BaseModel):
    """Unused: registrations are created through POST /events/{id}/register."""

    event_id: int


class RegistrationUpdate(BaseModel):
    """Unused: registrations change through register and cancel."""

    status: Literal["registered", "waitlisted", "cancelled"] | None = None
