import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import create_app
from app.ratelimit import login_limiter
from app.resources.users.models import User
from app.security import create_access_token, hash_password


@pytest.fixture()
def app(override_db):
    application = create_app()
    application.dependency_overrides[get_db] = override_db
    login_limiter.reset()
    return application


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def make_user(session_factory):
    def _make(email="user@campus-demo.test", role="student", name="Test User", password="password123"):
        with session_factory() as db:
            user = User(name=name, email=email, password_hash=hash_password(password), role=role,
                        department="School of Sciences")
            db.add(user)
            db.commit()
            db.refresh(user)
            return user

    return _make


@pytest.fixture()
def auth_headers():
    def _headers(user):
        return {"Authorization": f"Bearer {create_access_token(user.id)}"}

    return _headers


@pytest.fixture()
def make_event(session_factory):
    from datetime import datetime, timedelta, timezone

    from app.resources.events.models import Event

    counter = {"n": 0}

    def _make(organizer, title=None, days=3, hours=2, capacity=10, category="Workshop",
              venue="Seminar Hall", status="published", start=None, **extra):
        counter["n"] += 1
        begin = start or (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0)
        with session_factory() as db:
            event = Event(
                title=title or f"Event {counter['n']}", description="About this event", category=category,
                venue=venue, start_time=begin, end_time=begin + timedelta(hours=hours), capacity=capacity,
                organizer_id=organizer.id, status=status, **extra,
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            return event

    return _make


@pytest.fixture()
def make_registration(session_factory):
    from app.resources.registrations.models import Registration

    def _make(event, user, status="registered", created_at=None):
        with session_factory() as db:
            reg = Registration(event_id=event.id, user_id=user.id, status=status)
            if created_at:
                reg.created_at = created_at
                reg.updated_at = created_at
            db.add(reg)
            db.commit()
            db.refresh(reg)
            return reg

    return _make


@pytest.fixture()
def people(make_user):
    """One of each role plus a second faculty member."""
    return {
        "admin": make_user(email="admin@campus-demo.test", role="admin", name="Admin"),
        "faculty": make_user(email="faculty1@campus-demo.test", role="faculty", name="Meenakshi Iyer"),
        "faculty2": make_user(email="faculty2@campus-demo.test", role="faculty", name="Arvind Kulkarni"),
        "student": make_user(email="student@campus-demo.test", role="student", name="Aarav Sharma"),
        "student2": make_user(email="student2@campus-demo.test", role="student", name="Diya Nair"),
    }
