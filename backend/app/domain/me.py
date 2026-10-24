"""The signed in user's own registrations and organised events."""
import math
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.crud import BadRequest, ErrorResponse, Page
from app.core.crud.query import parse_list_query
from app.db import get_db
from app.deps import get_current_user
from app.resources.events.models import Event
from app.resources.events.router import config as events_config
from app.resources.events.schemas import EventRead
from app.resources.events.service import EventService
from app.resources.registrations.logic import waitlist_position
from app.resources.registrations.models import Registration
from app.resources.users.models import User

router = APIRouter(prefix="/me", tags=["Me"])


class MyRegistration(BaseModel):
    registration_id: int
    status: Literal["registered", "waitlisted", "cancelled"]
    waitlist_position: int | None
    registered_at: datetime
    event: EventRead


@router.get("/registrations", response_model=Page[MyRegistration], summary="My registrations",
            responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
            openapi_extra={"parameters": [
                {"name": "status", "in": "query", "required": False,
                 "description": "registered, waitlisted or cancelled. Comma separate several. Default: registered,waitlisted",
                 "schema": {"type": "string"}},
                {"name": "upcoming", "in": "query", "required": False,
                 "description": "true for events that have not ended, false for past ones",
                 "schema": {"type": "string"}},
                {"name": "page", "in": "query", "required": False, "schema": {"type": "integer"}},
                {"name": "limit", "in": "query", "required": False, "schema": {"type": "integer"}},
            ]})
def my_registrations(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    params = request.query_params
    for name in params.keys():
        if name not in ("status", "upcoming", "page", "limit"):
            raise BadRequest(f"Unknown filter '{name}'. Allowed filters: status, upcoming", {name: "Unknown filter"})
    try:
        page = int(params.get("page") or 1)
        limit = int(params.get("limit") or 20)
    except ValueError:
        raise BadRequest("'page' and 'limit' must be whole numbers")
    if page < 1 or limit < 1:
        raise BadRequest("'page' and 'limit' must be 1 or more")
    limit = min(limit, 100)

    statuses = [s.strip() for s in (params.get("status") or "registered,waitlisted").split(",") if s.strip()]
    if any(s not in ("registered", "waitlisted", "cancelled") for s in statuses):
        raise BadRequest("Invalid status. Use registered, waitlisted or cancelled", {"status": "Invalid value"})

    where = [Registration.user_id == user.id, Registration.status.in_(statuses)]
    order = Event.start_time.asc()
    upcoming = (params.get("upcoming") or "").lower()
    if upcoming in ("true", "false"):
        where.append(Event.end_time > func.now() if upcoming == "true" else Event.end_time <= func.now())
        order = Event.start_time.asc() if upcoming == "true" else Event.start_time.desc()
    elif upcoming:
        raise BadRequest("'upcoming' must be true or false", {"upcoming": "Use true or false"})

    joined = select(Registration, Event).join(Event, Event.id == Registration.event_id).where(*where)
    total = db.scalar(
        select(func.count()).select_from(Registration).join(Event, Event.id == Registration.event_id).where(*where)
    ) or 0
    rows = db.execute(joined.order_by(order, Registration.id).offset((page - 1) * limit).limit(limit)).all()

    events = EventService(db, events_config.permissions).present_many([event for _, event in rows], user)
    items = [
        MyRegistration(
            registration_id=reg.id, status=reg.status, waitlist_position=waitlist_position(db, reg),
            registered_at=reg.created_at, event=EventRead.model_validate(presented),
        )
        for (reg, _), presented in zip(rows, events)
    ]
    return {"items": items, "page": page, "limit": limit, "total": total, "pages": math.ceil(total / limit)}


@router.get("/events", response_model=Page[EventRead], summary="Events I organise",
            responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
            openapi_extra={"parameters": [
                {"name": n, "in": "query", "required": False, "schema": {"type": "string"}}
                for n in ("page", "limit", "sort", "q", "upcoming", "category", "status")
            ]})
def my_events(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = parse_list_query(request.query_params, events_config.list_spec())
    query.clauses.append(Event.organizer_id == user.id)
    service = EventService(db, events_config.permissions)
    items, total = service.list(user, query)
    return {
        "items": [EventRead.model_validate(p) for p in service.present_many(items, user)],
        "page": query.page, "limit": query.limit, "total": total, "pages": math.ceil(total / query.limit),
    }
