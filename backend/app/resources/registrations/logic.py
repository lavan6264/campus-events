"""Seat accounting shared by the registration endpoints, the events service and admin deletes.

Every function here expects the caller to hold the event row lock
(`SELECT ... FOR UPDATE`) so counts cannot change underneath it.
"""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.crud import Conflict, NotFound
from app.resources.events.models import Event
from app.resources.registrations.models import Registration
from app.resources.users.models import User


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


# register and cancel


def waitlist_position(db: Session, registration: Registration) -> int | None:
    if registration.status != "waitlisted":
        return None
    ahead = db.scalar(
        select(func.count()).select_from(Registration).where(
            Registration.event_id == registration.event_id,
            Registration.status == "waitlisted",
            (Registration.created_at < registration.created_at)
            | ((Registration.created_at == registration.created_at) & (Registration.id < registration.id)),
        )
    ) or 0
    return ahead + 1


def _clashing_event(db: Session, user_id: int, event: Event) -> Event | None:
    """A confirmed event of this user whose time range overlaps `event`."""
    return db.scalars(
        select(Event).join(Registration, Registration.event_id == Event.id)
        .where(
            Registration.user_id == user_id,
            Registration.status == "registered",
            Event.id != event.id,
            Event.start_time < event.end_time,
            Event.end_time > event.start_time,
        )
        .order_by(Event.start_time)
        .limit(1)
    ).first()


def register_user(db: Session, user: User, event_id: int) -> Registration:
    """Register for an event, or join its waitlist when it is full.

    Takes a row lock on the event, so two people taking the last seat are handled one
    after the other. The user row is locked too, so one person registering for two
    overlapping events at once cannot get past the clash check.
    """
    event = lock_event(db, event_id)
    if event is None:
        raise NotFound("Event not found")
    now = datetime.now(timezone.utc)
    if event.status == "cancelled":
        raise Conflict("Registration closed, event cancelled")
    if event.end_time <= now:
        raise Conflict("Registration closed, event ended")

    existing = db.scalars(
        select(Registration).where(Registration.event_id == event_id, Registration.user_id == user.id)
    ).first()
    if existing is not None and existing.status in ("registered", "waitlisted"):
        message = "You are already registered for this event" if existing.status == "registered" \
            else "You are already on the waitlist for this event"
        raise Conflict(message)

    db.execute(select(User.id).where(User.id == user.id).with_for_update())

    has_seat = confirmed_count(db, event_id) < event.capacity
    if has_seat:
        clash = _clashing_event(db, user.id, event)
        if clash is not None:
            raise Conflict(f'This event clashes with "{clash.title}", which you are already registered for')
    status = "registered" if has_seat else "waitlisted"

    if existing is None:
        registration = Registration(event_id=event_id, user_id=user.id, status=status)
        db.add(registration)
    else:
        # Re-registering after a cancellation goes to the back of the waitlist.
        registration = existing
        registration.status = status
        registration.created_at = now
        registration.updated_at = now
    db.flush()
    db.refresh(registration)
    return registration


def cancel_user_registration(db: Session, user: User, event_id: int) -> Registration:
    event = lock_event(db, event_id)
    if event is None:
        raise NotFound("Event not found")
    registration = db.scalars(
        select(Registration).where(Registration.event_id == event_id, Registration.user_id == user.id)
    ).first()
    if registration is None or registration.status == "cancelled":
        raise NotFound("You are not registered for this event")
    if event.end_time <= datetime.now(timezone.utc):
        raise Conflict("Cannot cancel, event already ended")
    was_confirmed = registration.status == "registered"
    registration.status = "cancelled"
    registration.updated_at = datetime.now(timezone.utc)
    db.flush()
    if was_confirmed:
        promote_waitlisted(db, event)
    return registration


def remove_registration(db: Session, event_id: int, registration_id: int) -> tuple[Registration, User]:
    """An organiser removes someone from their event. A freed confirmed seat goes to the waitlist."""
    event = lock_event(db, event_id)
    if event is None:
        raise NotFound("Event not found")
    registration = db.get(Registration, registration_id)
    if registration is None or registration.event_id != event_id:
        raise NotFound("Participant not found")
    if registration.status == "cancelled":
        raise Conflict("This person is already removed")
    if event.end_time <= datetime.now(timezone.utc):
        raise Conflict("Cannot remove anyone, event already ended")
    was_confirmed = registration.status == "registered"
    registration.status = "cancelled"
    registration.updated_at = datetime.now(timezone.utc)
    db.flush()
    if was_confirmed:
        promote_waitlisted(db, event)
    return registration, db.get(User, registration.user_id)
