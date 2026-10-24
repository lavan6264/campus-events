import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.db import Base, get_db
import app.models  # noqa: F401


@pytest.fixture(scope="session")
def engine():
    url = get_settings().test_database_url
    assert url.rsplit("/", 1)[-1].endswith("_test"), "Tests must run against the test database"
    eng = create_engine(url, pool_pre_ping=True)
    from tests.core.dummy import DummyBase

    for base in (Base, DummyBase):
        base.metadata.drop_all(eng)
        base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE dummy_widgets, registrations, events, users RESTART IDENTITY CASCADE"))
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture()
def override_db(session_factory):
    def _get_db():
        with session_factory() as session:
            try:
                yield session
            except Exception:
                session.rollback()
                raise

    return _get_db


@pytest.fixture(autouse=True, scope="session")
def fast_password_hashing():
    """Production uses bcrypt's default cost. Tests hash many users, so use the minimum."""
    import bcrypt

    original = bcrypt.gensalt
    bcrypt.gensalt = lambda rounds=4, prefix=b"2b": original(rounds=4, prefix=prefix)
    yield
    bcrypt.gensalt = original


@pytest.fixture(autouse=True)
def no_real_ai_calls(monkeypatch):
    """Tests never reach the real Gemini API, whatever is in .env. Use `fake_ai` to script replies."""
    monkeypatch.setattr("app.ai.client.get_client", lambda: None)


class FakeAI:
    """Stands in for the google-genai client. Script it with `reply(...)` or `fail(...)`."""

    def __init__(self):
        self.calls = []
        self._reply = None
        self._error = None
        self.models = self

    def reply(self, payload):
        import json

        self._reply = payload if isinstance(payload, str) else json.dumps(payload)
        self._error = None

    def fail(self, error=None):
        self._error = error or RuntimeError("model unavailable")

    def generate_content(self, model, contents, config):
        from types import SimpleNamespace

        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._error:
            raise self._error
        return SimpleNamespace(text=self._reply)

    @property
    def prompt(self):
        return self.calls[-1]["contents"]


@pytest.fixture()
def fake_ai(monkeypatch):
    fake = FakeAI()
    monkeypatch.setattr("app.ai.client.get_client", lambda: fake)
    return fake
