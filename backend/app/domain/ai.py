"""AI endpoints. Every response says whether it came from the model or the fallback."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import draft, recommend, search, summary
from app.core.crud import ErrorResponse
from app.db import get_db
from app.deps import get_current_user, require_roles
from app.domain.admin import compute_stats
from app.ratelimit import ai_limiter
from app.resources.events.models import Event
from app.resources.events.router import config as events_config
from app.resources.events.schemas import EventRead
from app.resources.events.service import EventService
from app.resources.users.models import User

Source = Literal["ai", "fallback"]
ERRORS = {401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}, 429: {"model": ErrorResponse}}


def _limit(user: User) -> None:
    if not ai_limiter.allow(f"user:{user.id}"):
        raise HTTPException(429, "Too many AI requests. Try again in a minute", headers={"Retry-After": "60"})


def signed_in(user: User = Depends(get_current_user)) -> User:
    _limit(user)
    return user


def organizer(user: User = Depends(require_roles("faculty", "admin"))) -> User:
    _limit(user)
    return user


def admin(user: User = Depends(require_roles("admin"))) -> User:
    _limit(user)
    return user


router = APIRouter(prefix="/ai", tags=["AI"])
admin_router = APIRouter(prefix="/admin/ai", tags=["AI", "Admin"])


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300, examples=["robotics workshops next week"])


class SearchResponse(BaseModel):
    source: Source
    filters: dict[str, str] = Field(description="Parameters accepted by GET /api/events")
    summary: str


@router.post("/search", response_model=SearchResponse, summary="Turn a sentence into event filters",
             responses=ERRORS)
def ai_search(payload: SearchRequest, _: User = Depends(signed_in)):
    return search.search(payload.query.strip())


class DraftRequest(BaseModel):
    notes: str = Field(min_length=1, max_length=2000)


class DraftResponse(BaseModel):
    source: Source
    title: str
    description: str
    category: str | None


@router.post("/draft-event", response_model=DraftResponse, summary="Draft an event from rough notes",
             responses=ERRORS)
def ai_draft(payload: DraftRequest, _: User = Depends(organizer)):
    """Nothing is saved. The organizer edits the draft and saves it through POST /api/events."""
    return draft.draft_event(payload.notes)


class RecommendationItem(BaseModel):
    event: EventRead
    reason: str


class RecommendationsResponse(BaseModel):
    source: Source
    items: list[RecommendationItem]


@router.get("/recommendations", response_model=RecommendationsResponse,
            summary="Upcoming events picked for me", responses=ERRORS)
def ai_recommendations(user: User = Depends(signed_in), db: Session = Depends(get_db)):
    result = recommend.recommend(db, user)
    ids = [event_id for event_id, _ in result.picks]
    events = {e.id: e for e in db.scalars(select(Event).where(Event.id.in_(ids)))} if ids else {}
    ordered = [(events[i], reason) for i, reason in result.picks if i in events]
    presented = EventService(db, events_config.permissions).present_many([e for e, _ in ordered], user)
    return {
        "source": result.source,
        "items": [{"event": EventRead.model_validate(p), "reason": reason}
                  for p, (_, reason) in zip(presented, ordered)],
    }


class SummaryResponse(BaseModel):
    source: Source
    sentences: list[str]
    summary: str


@admin_router.get("/summary", response_model=SummaryResponse, summary="Plain language analytics summary",
                  responses=ERRORS)
def ai_summary(_: User = Depends(admin), db: Session = Depends(get_db)):
    return summary.summarize(compute_stats(db))
