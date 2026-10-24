from collections.abc import Sequence
from typing import Any, Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.core.crud.errors import NotFound

M = TypeVar("M")
C = TypeVar("C", bound=BaseModel)
U = TypeVar("U", bound=BaseModel)


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CRUDRepository(Generic[M, C, U]):
    """Typed data access for one model. It flushes but never commits."""

    def __init__(self, db: Session, model: type[M], name: str | None = None):
        self.db = db
        self.model = model
        self.name = name or model.__name__

    def get(self, id: int, *, with_for_update: bool = False) -> M | None:
        stmt = select(self.model).where(self.model.id == id)  # type: ignore[attr-defined]
        if with_for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        return self.db.scalars(stmt).first()

    def get_or_404(self, id: int, *, with_for_update: bool = False) -> M:
        obj = self.get(id, with_for_update=with_for_update)
        if obj is None:
            raise NotFound(f"{self.name} not found")
        return obj

    def _where(
        self,
        filters: Sequence[ColumnElement],
        search: tuple[str, Sequence[str]] | None,
    ) -> list[ColumnElement]:
        clauses = list(filters)
        if search:
            text, fields = search
            pattern = f"%{_escape_like(text)}%"
            clauses.append(
                or_(*[getattr(self.model, f).ilike(pattern, escape="\\") for f in fields])
            )
        return clauses

    def list(
        self,
        filters: Sequence[ColumnElement] = (),
        search: tuple[str, Sequence[str]] | None = None,
        sort: Sequence[tuple[str, bool]] = (),
        page: int = 1,
        limit: int = 12,
    ) -> list[M]:
        stmt = select(self.model).where(*self._where(filters, search))
        order = [
            getattr(self.model, name).desc() if desc else getattr(self.model, name).asc()
            for name, desc in sort
        ]
        order.append(self.model.id.asc())  # type: ignore[attr-defined]  # stable pages
        stmt = stmt.order_by(*order).offset((page - 1) * limit).limit(limit)
        return list(self.db.scalars(stmt))

    def count(
        self,
        filters: Sequence[ColumnElement] = (),
        search: tuple[str, Sequence[str]] | None = None,
    ) -> int:
        stmt = select(func.count()).select_from(self.model).where(*self._where(filters, search))
        return self.db.scalar(stmt) or 0

    def create(self, data: C | dict[str, Any]) -> M:
        values = data if isinstance(data, dict) else data.model_dump()
        obj = self.model(**values)
        self.db.add(obj)
        self.db.flush()
        self.db.refresh(obj)
        return obj

    def update(self, obj: M, data: U | dict[str, Any]) -> M:
        values = data if isinstance(data, dict) else data.model_dump(exclude_unset=True)
        for key, value in values.items():
            setattr(obj, key, value)
        self.db.flush()
        self.db.refresh(obj)
        return obj

    def delete(self, obj: M) -> None:
        self.db.delete(obj)
        self.db.flush()

    def exists(self, **kwargs: Any) -> bool:
        conditions = [getattr(self.model, key) == value for key, value in kwargs.items()]
        return self.db.scalar(select(select(self.model.id).where(*conditions).exists())) or False  # type: ignore[attr-defined]
