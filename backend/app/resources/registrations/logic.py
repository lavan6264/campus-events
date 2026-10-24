"""Seat accounting shared by the registration endpoints, the events service and admin deletes.

Every function here expects the caller to hold the event row lock
(`SELECT ... FOR UPDATE`) so counts cannot change underneath it.
"""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.resources.events.models import Event
from app.resources.registrations.models import Registration


def confirmed_count(db: Session, event_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(Registration)
        .where(Registration.event_id == event_id, Registration.status == "registered")
    ) or 0


def lock_event(db: Session, event_id: int) -> Event | None:
    stmt = select(Event).where(Event.id == event_id).with_for_update().execution_options(populate_existing=True)
    return db.scalars(stmt).first()


def promote_waitlisted(db: Session, event: Event) -> list[Registration]:
    """Move the oldest waitlisted registrations into any free seats.

    A promotion is never undone because of a time clash with another confirmed event.
    """
    if event.status != "published":
        return []
    free = event.capacity - confirmed_count(db, event.id)
    if free <= 0:
        return []
    waiting = list(db.scalars(
        select(Registration)
        .where(Registration.event_id == event.id, Registration.status == "waitlisted")
        .order_by(Registration.created_at, Registration.id)
        .limit(free)
        .with_for_update()
    ))
    now = datetime.now(timezone.utc)
    for registration in waiting:
        registration.status = "registered"
        registration.updated_at = now
    db.flush()
    return waiting
