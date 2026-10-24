"""Imports every model so Alembic and tests see the full metadata."""
from app.resources.events.models import Event
from app.resources.registrations.models import Registration
from app.resources.users.models import User

__all__ = ["Event", "Registration", "User"]
