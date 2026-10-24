from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Request scoped session.

    It never commits on its own. Routers commit explicitly once a unit of work is
    complete, so a failed request always rolls back.
    """
    with SessionLocal() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
