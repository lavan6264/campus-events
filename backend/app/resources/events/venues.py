"""Venue bookings: one room cannot hold two published events at the same time."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.resources.events.models import Event


def normalise_venue(venue: str) -> str:
    """"Innovation  Lab " and "innovation lab" are the same room."""
    return " ".join(venue.split()).lower()


def find_venue_clash(
    db: Session, venue: str, start: datetime, end: datetime, exclude_id: int | None = None
) -> Event | None:
    """The earliest published event in the same venue that overlaps [start, end).

    Takes a transaction level lock on the venue first. Two organisers saving the same room at the same
    moment are then handled one after the other, and the second one sees the first one's booking.
    The lock is released when the request commits or rolls back.
    """
    key = normalise_venue(venue)
    db.execute(select(func.pg_advisory_xact_lock(func.hashtext(key))))
    stored = func.regexp_replace(func.lower(func.btrim(Event.venue)), r"\s+", " ", "g")
    stmt = select(Event).where(
        Event.status == "published",
        stored == key,
        Event.start_time < end,
        Event.end_time > start,
    )
    if exclude_id is not None:
        stmt = stmt.where(Event.id != exclude_id)
    return db.scalars(stmt.order_by(Event.start_time).limit(1)).first()
