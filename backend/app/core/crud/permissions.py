"""Declarative permissions: allowed roles plus an optional ownership rule."""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.core.crud.errors import Forbidden, Unauthorized

ACTIONS = ("list", "read", "create", "update", "delete")

OwnershipRule = Callable[[Any, Any], bool]


@dataclass(frozen=True)
class Perm:
    """Who may perform an action.

    roles: None means any signed in user, a tuple limits it to those roles
        (an empty tuple means no role qualifies, so only `ownership` can allow it).
    ownership: optional rule `(user, obj) -> bool`, checked only when an object exists.
    public: anyone, signed in or not.
    """

    roles: tuple[str, ...] | None = None
    ownership: OwnershipRule | None = None
    public: bool = False


def owner(field: str) -> OwnershipRule:
    """Ownership rule: the object's `field` equals the user's id."""
    return lambda user, obj: getattr(obj, field) == user.id


def check(perm: Perm, user: Any, obj: Any = None, action: str = "do this") -> None:
    if perm.public:
        return
    if user is None:
        raise Unauthorized("Please sign in to continue")
    if perm.roles is None or user.role in perm.roles:
        return
    if perm.ownership is not None and obj is not None and perm.ownership(user, obj):
        return
    raise Forbidden(f"You do not have permission to {action}")
