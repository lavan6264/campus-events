from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.resources.events.models import CATEGORIES


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


AwareDatetime = Annotated[datetime, AfterValidator(_aware)]
Category = str


def _check_category(value: str | None) -> str | None:
    if value is not None and value not in CATEGORIES:
        raise ValueError(f"Choose one of: {', '.join(CATEGORIES)}")
    return value


def _check_end(value: datetime | None, info: ValidationInfo) -> datetime | None:
    start = info.data.get("start_time")
    if value is not None and start is not None and value <= start:
        raise ValueError("Must be after the start time")
    return value


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    category: str
    venue: str
    start_time: datetime
    end_time: datetime
    capacity: int
    organizer_id: int
    organizer_name: str | None = None
    status: Literal["published", "cancelled"]
    created_at: datetime
    # Computed per request
    registered_count: int = 0
    waitlisted_count: int = 0
    seats_left: int = 0
    my_status: Literal["registered", "waitlisted"] | None = None
    my_waitlist_position: int | None = None
    clash_with_id: int | None = None
    clash_with_title: str | None = None


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    category: Category
    venue: str = Field(min_length=1, max_length=120)
    start_time: AwareDatetime
    end_time: AwareDatetime
    capacity: int = Field(gt=0, le=100000)

    _category = field_validator("category")(_check_category)
    _end = field_validator("end_time")(_check_end)


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category: Category | None = None
    venue: str | None = Field(default=None, min_length=1, max_length=120)
    start_time: AwareDatetime | None = None
    end_time: AwareDatetime | None = None
    capacity: int | None = Field(default=None, gt=0, le=100000)
    status: Literal["published", "cancelled"] | None = None

    _category = field_validator("category")(_check_category)
    _end = field_validator("end_time")(_check_end)
