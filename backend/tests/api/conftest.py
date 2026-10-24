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
