from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select

from app.core.crud import CRUDService, Unprocessable, register_constraint_message
from app.resources.events.models import Event
from app.resources.events.schemas import EventCreate, EventUpdate
from app.resources.registrations.logic import confirmed_count, lock_event, promote_waitlisted
from app.resources.registrations.models import Registration
from app.resources.users.models import User

register_constraint_message("ck_events_capacity_positive", "capacity", "Must be greater than 0")
register_constraint_message("ck_events_end_after_start", "end_time", "Must be after the start time")


def _overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


class EventService(CRUDService[Event, EventCreate, EventUpdate]):
    model = Event
    resource_name = "Event"

    # domain rules

    def before_create(self, data, user):
        data["organizer_id"] = user.id
        return data

    def before_update(self, obj, data, user):
        # Lock the row so the confirmed count cannot change while we compare it.
        locked = lock_event(self.db, obj.id)
        start = data.get("start_time", locked.start_time)
        end = data.get("end_time", locked.end_time)
        if end <= start:
            raise Unprocessable("End time must be after the start time", {"end_time": "Must be after the start time"})
        for key in ("title", "category", "venue", "capacity", "status", "start_time", "end_time"):
            if key in data and data[key] is None:
                del data[key]
        if "description" in data and data["description"] is None:
            data["description"] = ""
        capacity = data.get("capacity")
        if capacity is not None:
            confirmed = confirmed_count(self.db, obj.id)
            if capacity < confirmed:
                raise Unprocessable(
                    f"Capacity cannot be lower than the {confirmed} confirmed registrations",
                    {"capacity": f"Must be at least {confirmed} (confirmed registrations)"},
                )
        return data

    def after_update(self, obj, user):
        # New seats (higher capacity) go to the waitlist, oldest first.
        promote_waitlisted(self.db, obj)

    # computed fields

    def present(self, obj, user):
        return self.present_many([obj], user)[0]

    def present_many(self, objs, user):
        if not objs:
            return []
        ids = [o.id for o in objs]
        counts: dict[tuple[int, str], int] = {}
        for event_id, status, n in self.db.execute(
            select(Registration.event_id, Registration.status, func.count())
            .where(Registration.event_id.in_(ids), Registration.status.in_(("registered", "waitlisted")))
            .group_by(Registration.event_id, Registration.status)
        ):
            counts[(event_id, status)] = n

        names = dict(self.db.execute(
            select(User.id, User.name).where(User.id.in_({o.organizer_id for o in objs}))
        ).all())

        mine: dict[int, tuple[str, datetime, int]] = {}
        confirmed_events: list[Event] = []
        if user is not None:
            for reg in self.db.execute(
                select(Registration.event_id, Registration.status, Registration.created_at, Registration.id)
                .where(Registration.user_id == user.id, Registration.status.in_(("registered", "waitlisted")))
            ):
                if reg.event_id in ids:
                    mine[reg.event_id] = (reg.status, reg.created_at, reg.id)
            confirmed_events = list(self.db.scalars(
                select(Event).join(Registration, Registration.event_id == Event.id)
                .where(Registration.user_id == user.id, Registration.status == "registered",
                       Event.end_time > datetime.now(timezone.utc))
            ))

        result: list[dict[str, Any]] = []
        for obj in objs:
            row = {c.key: getattr(obj, c.key) for c in obj.__table__.columns}
            registered = counts.get((obj.id, "registered"), 0)
            row["organizer_name"] = names.get(obj.organizer_id)
            row["registered_count"] = registered
            row["waitlisted_count"] = counts.get((obj.id, "waitlisted"), 0)
            row["seats_left"] = max(obj.capacity - registered, 0)

            status = mine.get(obj.id)
            row["my_status"] = status[0] if status else None
            row["my_waitlist_position"] = None
            if status and status[0] == "waitlisted":
                row["my_waitlist_position"] = 1 + (self.db.scalar(
                    select(func.count()).select_from(Registration).where(
                        Registration.event_id == obj.id, Registration.status == "waitlisted",
                        (Registration.created_at < status[1])
                        | ((Registration.created_at == status[1]) & (Registration.id < status[2])),
                    )
                ) or 0)

            row["clash_with_id"] = row["clash_with_title"] = None
            for other in confirmed_events:
                if other.id != obj.id and _overlaps(obj.start_time, obj.end_time, other.start_time, other.end_time):
                    row["clash_with_id"], row["clash_with_title"] = other.id, other.title
                    break
            result.append(row)
        return result
