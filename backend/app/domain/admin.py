"""Admin only endpoints: analytics and role changes."""
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.crud import ErrorResponse, Forbidden, NotFound
from app.db import get_db
from app.deps import require_roles
from app.resources.events.models import CATEGORIES, Event
from app.resources.registrations.models import Registration
from app.resources.users.models import ROLES, User
from app.resources.users.schemas import UserRead

router = APIRouter(prefix="/admin", tags=["Admin"])
admin_only = require_roles("admin")
ERRORS = {401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}}

NEAR_CAPACITY = 0.8
DAYS = 30


class Totals(BaseModel):
    users: int
    events: int
    published_events: int
    cancelled_events: int
    upcoming_events: int
    past_events: int
    confirmed_registrations: int
    waitlisted_registrations: int
    cancelled_registrations: int
    capacity: int
    fill_rate: float  # percent of seats in published events that are taken


class CategoryStat(BaseModel):
    category: str
    events: int
    registrations: int
    capacity: int
    fill_rate: float


class EventStat(BaseModel):
    id: int
    title: str
    category: str
    start_time: datetime
    capacity: int
    registered: int
    waitlisted: int
    fill_rate: float


class DayStat(BaseModel):
    date: date
    registrations: int


class RoleStat(BaseModel):
    role: Literal["student", "faculty", "admin"]
    registrations: int


class Stats(BaseModel):
    generated_at: datetime
    totals: Totals
    registrations_per_category: list[CategoryStat]
    top_events: list[EventStat]
    near_capacity: list[EventStat]
    registrations_per_day: list[DayStat]
    registrations_by_role: list[RoleStat]


def _rate(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def compute_stats(db: Session, now: datetime | None = None) -> Stats:
    now = now or datetime.now(timezone.utc)

    confirmed = func.count(case((Registration.status == "registered", 1))).label("confirmed")
    waiting = func.count(case((Registration.status == "waitlisted", 1))).label("waiting")
    rows = db.execute(
        select(Event, confirmed, waiting)
        .outerjoin(Registration, Registration.event_id == Event.id)
        .group_by(Event.id)
    ).all()
    events = [
        EventStat(id=e.id, title=e.title, category=e.category, start_time=e.start_time,
                  capacity=e.capacity, registered=c, waitlisted=w, fill_rate=_rate(min(c, e.capacity), e.capacity))
        for e, c, w in rows
    ]
    by_id = {e.id: e for e, _, _ in rows}
    published = [s for s in events if by_id[s.id].status == "published"]

    reg_counts = dict(db.execute(select(Registration.status, func.count()).group_by(Registration.status)).all())
    seats = sum(s.capacity for s in published)
    taken = sum(min(s.registered, s.capacity) for s in published)

    totals = Totals(
        users=db.scalar(select(func.count()).select_from(User)) or 0,
        events=len(events),
        published_events=len(published),
        cancelled_events=len(events) - len(published),
        upcoming_events=sum(1 for s in published if by_id[s.id].start_time >= now),
        past_events=sum(1 for s in published if by_id[s.id].end_time < now),
        confirmed_registrations=reg_counts.get("registered", 0),
        waitlisted_registrations=reg_counts.get("waitlisted", 0),
        cancelled_registrations=reg_counts.get("cancelled", 0),
        capacity=seats,
        fill_rate=_rate(taken, seats),
    )

    categories = []
    for name in CATEGORIES:
        group = [s for s in published if s.category == name]
        cap = sum(s.capacity for s in group)
        regs = sum(s.registered for s in group)
        categories.append(CategoryStat(
            category=name, events=len(group), registrations=regs, capacity=cap,
            fill_rate=_rate(sum(min(s.registered, s.capacity) for s in group), cap),
        ))

    top = sorted(published, key=lambda s: (-s.registered, s.start_time))[:5]
    near = sorted(
        (s for s in published
         if by_id[s.id].start_time >= now and s.fill_rate >= NEAR_CAPACITY * 100),
        key=lambda s: (-s.fill_rate, s.start_time),
    )[:5]

    first_day = (now - timedelta(days=DAYS - 1)).date()
    day_col = func.date(func.timezone("UTC", Registration.created_at))
    per_day = {
        d: n for d, n in db.execute(
            select(day_col, func.count())
            .where(Registration.status != "cancelled", day_col >= first_day)
            .group_by(day_col)
        )
    }
    days = [
        DayStat(date=first_day + timedelta(days=i), registrations=per_day.get(first_day + timedelta(days=i), 0))
        for i in range(DAYS)
    ]

    role_counts = dict(db.execute(
        select(User.role, func.count()).select_from(Registration).join(User, User.id == Registration.user_id)
        .where(Registration.status == "registered").group_by(User.role)
    ).all())

    return Stats(
        generated_at=now,
        totals=totals,
        registrations_per_category=categories,
        top_events=top,
        near_capacity=near,
        registrations_per_day=days,
        registrations_by_role=[RoleStat(role=r, registrations=role_counts.get(r, 0)) for r in ROLES],
    )


@router.get("/stats", response_model=Stats, summary="Analytics for the reports screen", responses=ERRORS)
def stats(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    return compute_stats(db)


class RoleChange(BaseModel):
    role: Literal["student", "faculty", "admin"]


@router.patch(
    "/users/{id}/role", response_model=UserRead, summary="Change a user's role",
    responses={**ERRORS, 404: {"model": ErrorResponse}},
)
def change_role(id: int, payload: RoleChange, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    target = db.get(User, id)
    if target is None:
        raise NotFound("User not found")
    if target.id == admin.id and payload.role != "admin":
        raise Forbidden("You cannot remove your own admin role")
    target.role = payload.role
    db.flush()
    db.refresh(target)
    db.commit()
    return target
