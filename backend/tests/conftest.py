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
