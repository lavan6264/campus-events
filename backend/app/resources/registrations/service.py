from sqlalchemy import select

from app.core.crud import CRUDService
from app.resources.events.models import Event
from app.resources.registrations.logic import lock_event, promote_waitlisted
from app.resources.registrations.models import Registration
from app.resources.registrations.schemas import RegistrationCreate, RegistrationUpdate
from app.resources.users.models import User


class RegistrationService(CRUDService[Registration, RegistrationCreate, RegistrationUpdate]):
    model = Registration
    resource_name = "Registration"

    def before_delete(self, obj, user):
        lock_event(self.db, obj.event_id)

    def after_delete(self, obj, user):
        # A freed confirmed seat goes to the oldest waitlisted person.
        if obj.status == "registered":
            event = self.db.get(Event, obj.event_id)
            if event is not None:
                promote_waitlisted(self.db, event)

    def present(self, obj, user):
        return self.present_many([obj], user)[0]

    def present_many(self, objs, user):
        if not objs:
            return []
        titles = dict(self.db.execute(
            select(Event.id, Event.title).where(Event.id.in_({o.event_id for o in objs}))).all())
        names = dict(self.db.execute(
            select(User.id, User.name).where(User.id.in_({o.user_id for o in objs}))).all())
        return [
            {**{c.key: getattr(o, c.key) for c in o.__table__.columns},
             "event_title": titles.get(o.event_id), "user_name": names.get(o.user_id)}
            for o in objs
        ]
