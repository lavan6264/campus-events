"""The list query convention shared by every resource.

?page=1&limit=12            pagination (limit is capped by the resource's max_limit)
?sort=name or ?sort=-name   whitelisted sort fields, comma separated for several
?q=text                     case insensitive search across the configured search fields
?field=value                exact filter
?field__gte= / __lte=       range filter
?field__in=a,b              set filter
?<custom>=value             custom filter callable

Only filters declared on the resource are accepted. Anything else returns 400.
"""
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import ColumnElement

from app.core.crud.errors import BadRequest

RESERVED = ("page", "limit", "sort", "q")


def _coerce(model: type, column_name: str, raw: str) -> Any:
    column = getattr(model, column_name).property.columns[0]
    try:
        py = column.type.python_type
    except NotImplementedError:
        return raw
    if py is bool:
        lowered = raw.strip().lower()
        if lowered in ("true", "1", "yes"):
            return True
        if lowered in ("false", "0", "no"):
            return False
        raise ValueError("Use true or false")
    if py is int:
        return int(raw)
    if py is float:
        return float(raw)
    if py is datetime:
        return _parse_datetime(raw)
    if py is date:
        return date.fromisoformat(raw)
    return raw


def _parse_datetime(raw: str) -> datetime:
    # A "+" in a query string arrives as a space, so retry with the offset sign restored.
    for candidate in (raw.strip(), raw.strip().replace(" ", "+")):
        try:
            value = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    raise ValueError("Use an ISO date or date time, for example 2026-03-01 or 2026-03-01T10:00:00Z")


class Filter:
    """Base class. A filter owns one or more query parameter names."""

    def params(self) -> list[str]:
        raise NotImplementedError

    def clause(self, model: type, param: str, raw: str) -> ColumnElement:
        raise NotImplementedError


@dataclass(frozen=True)
class Exact(Filter):
    field: str

    def params(self) -> list[str]:
        return [self.field]

    def clause(self, model, param, raw):
        return getattr(model, self.field) == _coerce(model, self.field, raw)


@dataclass(frozen=True)
class Range(Filter):
    field: str

    def params(self) -> list[str]:
        return [f"{self.field}__gte", f"{self.field}__lte"]

    def clause(self, model, param, raw):
        column = getattr(model, self.field)
        value = _coerce(model, self.field, raw)
        return column >= value if param.endswith("__gte") else column <= value


@dataclass(frozen=True)
class InSet(Filter):
    field: str

    def params(self) -> list[str]:
        return [f"{self.field}__in"]

    def clause(self, model, param, raw):
        values = [_coerce(model, self.field, part) for part in raw.split(",") if part.strip()]
        if not values:
            raise ValueError("Give at least one value, separated by commas")
        return getattr(model, self.field).in_(values)


@dataclass(frozen=True)
class Custom(Filter):
    """A filter implemented by a callable `(value: str) -> SQL clause`.

    The callable may raise ValueError to reject a value.
    """

    name: str
    fn: Callable[[str], ColumnElement]

    def params(self) -> list[str]:
        return [self.name]

    def clause(self, model, param, raw):
        return self.fn(raw)


@dataclass
class ListSpec:
    model: type
    filters: Sequence[Filter] = ()
    search_fields: Sequence[str] = ()
    sortable_fields: Sequence[str] = ()
    default_sort: str = "-id"
    default_limit: int = 12
    max_limit: int = 100


@dataclass
class ListQuery:
    page: int = 1
    limit: int = 12
    sort: list[tuple[str, bool]] = field(default_factory=list)  # (field, descending)
    search: tuple[str, Sequence[str]] | None = None
    clauses: list[ColumnElement] = field(default_factory=list)


def _int_param(params: Mapping[str, str], name: str, default: int) -> int:
    raw = params.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise BadRequest(f"'{name}' must be a whole number", {name: "Must be a whole number"})
    return value


def parse_list_query(params: Mapping[str, str], spec: ListSpec) -> ListQuery:
    page = _int_param(params, "page", 1)
    if page < 1:
        raise BadRequest("'page' must be 1 or more", {"page": "Must be 1 or more"})
    limit = _int_param(params, "limit", spec.default_limit)
    if limit < 1:
        raise BadRequest("'limit' must be 1 or more", {"limit": "Must be 1 or more"})
    limit = min(limit, spec.max_limit)

    sort_raw = params.get("sort") or spec.default_sort
    sort: list[tuple[str, bool]] = []
    for part in (p.strip() for p in sort_raw.split(",") if p.strip()):
        descending = part.startswith("-")
        name = part.lstrip("-+")
        if name not in spec.sortable_fields:
            allowed = ", ".join(spec.sortable_fields)
            raise BadRequest(
                f"Cannot sort by '{name}'. Allowed fields: {allowed}", {"sort": "Not a sortable field"}
            )
        sort.append((name, descending))

    search = None
    q = (params.get("q") or "").strip()
    if q:
        if not spec.search_fields:
            raise BadRequest("This resource does not support search", {"q": "Search is not available"})
        search = (q, tuple(spec.search_fields))

    by_param: dict[str, Filter] = {p: f for f in spec.filters for p in f.params()}
    clauses: list[ColumnElement] = []
    for name in params.keys():
        if name in RESERVED:
            continue
        flt = by_param.get(name)
        if flt is None:
            allowed = ", ".join(sorted(by_param)) or "none"
            raise BadRequest(
                f"Unknown filter '{name}'. Allowed filters: {allowed}", {name: "Unknown filter"}
            )
        raw = params.get(name) or ""
        try:
            clauses.append(flt.clause(spec.model, name, raw))
        except ValueError as exc:
            message = str(exc) or "Invalid value"
            if message.startswith("invalid literal"):
                message = "Invalid value"
            raise BadRequest(f"Invalid value for '{name}': {message}", {name: message})

    return ListQuery(page=page, limit=limit, sort=sort, search=search, clauses=clauses)
