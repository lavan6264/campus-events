"""Domain endpoints beside the generated /events routes: categories, register, cancel,
participants and CSV export."""
import csv
import io
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.crud import BadRequest, ErrorResponse, Forbidden, NotFound, Page
from app.db import get_db
from app.deps import get_current_user
from app.resources.events.models import CATEGORIES, Event
from app.resources.registrations.logic import (
    cancel_user_registration, register_user, remove_registration, waitlist_position,
)
from app.resources.registrations.models import Registration
from app.resources.users.models import User

router = APIRouter(prefix="/events", tags=["Events"])

ERRORS = {
    401: {"model": ErrorResponse}, 403: {"model": ErrorResponse},
    404: {"model": ErrorResponse}, 409: {"model": ErrorResponse},
}


class RegistrationResult(BaseModel):
    status: Literal["registered", "waitlisted", "cancelled"]
    waitlist_position: int | None = None
    message: str


class ParticipantRead(BaseModel):
    registration_id: int
    user_id: int
    name: str
    email: str
    department: str | None
    status: Literal["registered", "waitlisted", "cancelled"]
    waitlist_position: int | None
    registered_at: datetime


@router.get("/categories", response_model=list[str], summary="List event categories",
            responses={401: {"model": ErrorResponse}})
def categories(user: User = Depends(get_current_user)):
    return list(CATEGORIES)


@router.post("/{id}/register", response_model=RegistrationResult, status_code=201,
             summary="Register for an event or join its waitlist", responses=ERRORS)
def register(id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    registration = register_user(db, user, id)
    position = waitlist_position(db, registration)
    db.commit()
    if registration.status == "registered":
        return RegistrationResult(status="registered", message="You are registered")
    return RegistrationResult(
        status="waitlisted", waitlist_position=position,
        message=f"The event is full. You are on the waitlist (position {position})",
    )


@router.delete("/{id}/register", response_model=RegistrationResult,
               summary="Cancel your registration or leave the waitlist", responses=ERRORS)
def cancel(id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cancel_user_registration(db, user, id)
    db.commit()
    return RegistrationResult(status="cancelled", message="Your registration is cancelled")


# participants

SORTS = {"name": User.name, "created_at": Registration.created_at, "status": Registration.status}
STATUSES = ("registered", "waitlisted", "cancelled")


def _organizer_event(db: Session, user: User, event_id: int) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise NotFound("Event not found")
    if user.role != "admin" and event.organizer_id != user.id:
        raise Forbidden("Only the organizer or an admin can see the participants")
    return event


def _participant_rows(db: Session, event: Event, params, paged: bool):
    allowed = {"page", "limit", "sort", "q", "status", "status__in"}
    for name in params.keys():
        if name not in allowed:
            raise BadRequest(f"Unknown filter '{name}'. Allowed filters: status, status__in, q",
                             {name: "Unknown filter"})

    statuses = ["registered", "waitlisted"]
    raw = params.get("status") or params.get("status__in")
    if raw:
        statuses = [s.strip() for s in raw.split(",") if s.strip()]
        bad = [s for s in statuses if s not in STATUSES]
        if bad:
            raise BadRequest(f"Invalid status '{bad[0]}'. Use: {', '.join(STATUSES)}", {"status": "Invalid value"})

    sort_raw = params.get("sort") or "created_at"
    descending = sort_raw.startswith("-")
    sort_key = sort_raw.lstrip("-")
    if sort_key not in SORTS:
        raise BadRequest(f"Cannot sort by '{sort_key}'. Allowed fields: {', '.join(SORTS)}",
                         {"sort": "Not a sortable field"})

    try:
        page = int(params.get("page") or 1)
        limit = int(params.get("limit") or 20)
    except ValueError:
        raise BadRequest("'page' and 'limit' must be whole numbers")
    if page < 1 or limit < 1:
        raise BadRequest("'page' and 'limit' must be 1 or more")
    limit = min(limit, 100)

    where = [Registration.event_id == event.id, Registration.status.in_(statuses)]
    q = (params.get("q") or "").strip()
    if q:
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append(or_(
            User.name.ilike(pattern, escape="\\"), User.email.ilike(pattern, escape="\\"),
            User.department.ilike(pattern, escape="\\"),
        ))

    base = select(Registration, User).join(User, User.id == Registration.user_id).where(*where)
    total = db.scalar(
        select(func.count()).select_from(Registration).join(User, User.id == Registration.user_id).where(*where)
    ) or 0
    column = SORTS[sort_key]
    stmt = base.order_by(column.desc() if descending else column.asc(), Registration.id)
    if paged:
        stmt = stmt.offset((page - 1) * limit).limit(limit)

    positions = {
        row.id: row.position for row in db.execute(
            select(Registration.id,
                   func.row_number().over(order_by=(Registration.created_at, Registration.id)).label("position"))
            .where(Registration.event_id == event.id, Registration.status == "waitlisted")
        )
    }
    rows = [
        ParticipantRead(
            registration_id=reg.id, user_id=usr.id, name=usr.name, email=usr.email,
            department=usr.department, status=reg.status,
            waitlist_position=positions.get(reg.id) if reg.status == "waitlisted" else None,
            registered_at=reg.created_at,
        )
        for reg, usr in db.execute(stmt)
    ]
    return rows, total, page, limit


@router.get("/{id}/participants", response_model=Page[ParticipantRead],
            summary="List participants of an event (organizer or admin)", responses=ERRORS)
def participants(id: int, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = _organizer_event(db, user, id)
    rows, total, page, limit = _participant_rows(db, event, request.query_params, paged=True)
    return {"items": rows, "page": page, "limit": limit, "total": total, "pages": -(-total // limit)}


def _csv_safe(value: object) -> str:
    """Stops spreadsheet programs from running a cell that starts with a formula character."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/{id}/participants.csv", summary="Download participants as CSV (organizer or admin)",
            response_class=Response, responses={200: {"content": {"text/csv": {}}}, **ERRORS})
def participants_csv(id: int, request: Request, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    event = _organizer_event(db, user, id)
    rows, _, _, _ = _participant_rows(db, event, request.query_params, paged=False)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Name", "Email", "Department", "Status", "Waitlist position", "Registered at"])
    for r in rows:
        writer.writerow([
            _csv_safe(r.name), _csv_safe(r.email), _csv_safe(r.department), r.status,
            r.waitlist_position or "", r.registered_at.isoformat(),
        ])
    return Response(
        content="﻿" + out.getvalue(),  # BOM so Excel reads UTF-8 names correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="event-{event.id}-participants.csv"'},
    )


@router.delete("/{id}/participants/{registration_id}", response_model=RegistrationResult,
               summary="Remove a participant from an event (organiser or admin)", responses=ERRORS)
def remove_participant(id: int, registration_id: int, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    """Frees the seat. If someone is on the waitlist, the oldest person gets it."""
    _organizer_event(db, user, id)
    _, removed = remove_registration(db, id, registration_id)
    db.commit()
    return RegistrationResult(status="cancelled", message=f"{removed.name} was removed")
