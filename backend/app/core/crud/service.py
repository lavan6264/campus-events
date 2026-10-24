from collections.abc import Mapping, Sequence
from typing import Any, Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.crud import permissions
from app.core.crud.errors import Forbidden
from app.core.crud.permissions import Perm
from app.core.crud.query import ListQuery
from app.core.crud.repository import CRUDRepository

M = TypeVar("M")
C = TypeVar("C", bound=BaseModel)
U = TypeVar("U", bound=BaseModel)


class CRUDService(Generic[M, C, U]):
    """One per resource. Subclass it, set `model`, and override hooks for domain rules.

    Hooks receive the acting user and run in this order for a write:
    authorize, before_*, repository call, after_*. Hooks that change the data
    return the dict to store.
    """

    model: type[M]
    resource_name: str | None = None

    def __init__(self, db: Session, permissions: Mapping[str, Perm] | None = None):
        self.db = db
        self.permissions: Mapping[str, Perm] = permissions or {}
        self.repo: CRUDRepository[M, C, U] = CRUDRepository(db, self.model, self.resource_name)

    # authorization

    def authorize(self, action: str, user: Any, obj: M | None = None) -> None:
        """Called for every action. Built in rules come from the router config.

        Override and call super() to add custom rules in code.
        """
        perm = self.permissions.get(action)
        if perm is None:
            raise Forbidden("This action is not allowed")
        permissions.check(perm, user, obj, action=f"{action} this {self.repo.name.lower()}")

    # hooks

    def before_create(self, data: dict[str, Any], user: Any) -> dict[str, Any]:
        return data

    def after_create(self, obj: M, user: Any) -> None:
        pass

    def before_update(self, obj: M, data: dict[str, Any], user: Any) -> dict[str, Any]:
        return data

    def after_update(self, obj: M, user: Any) -> None:
        pass

    def before_delete(self, obj: M, user: Any) -> None:
        pass

    def after_delete(self, obj: M, user: Any) -> None:
        pass

    # presentation: lets a resource add computed fields before serialisation

    def present(self, obj: M, user: Any) -> Any:
        return obj

    def present_many(self, objs: Sequence[M], user: Any) -> list[Any]:
        return [self.present(obj, user) for obj in objs]

    # operations

    def list(self, user: Any, query: ListQuery) -> tuple[list[M], int]:
        self.authorize("list", user)
        items = self.repo.list(query.clauses, query.search, query.sort, query.page, query.limit)
        total = self.repo.count(query.clauses, query.search)
        return items, total

    def get(self, user: Any, id: int) -> M:
        obj = self.repo.get_or_404(id)
        self.authorize("read", user, obj)
        return obj

    def create(self, user: Any, payload: C) -> M:
        self.authorize("create", user)
        data = self.before_create(payload.model_dump(), user)
        obj = self.repo.create(data)
        self.after_create(obj, user)
        return obj

    def update(self, user: Any, id: int, payload: U) -> M:
        obj = self.repo.get_or_404(id)
        self.authorize("update", user, obj)
        data = self.before_update(obj, payload.model_dump(exclude_unset=True), user)
        obj = self.repo.update(obj, data)
        self.after_update(obj, user)
        return obj

    def delete(self, user: Any, id: int) -> None:
        obj = self.repo.get_or_404(id)
        self.authorize("delete", user, obj)
        self.before_delete(obj, user)
        self.repo.delete(obj)
        self.after_delete(obj, user)
