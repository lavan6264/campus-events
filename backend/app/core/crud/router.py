"""`crud_router(config)` builds a full REST router for one resource.

Do not add `from __future__ import annotations` here: the generated route
functions use the schema classes as real annotations.
"""
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.crud.errors import MethodNotAllowed
from app.core.crud.permissions import ACTIONS, Perm
from app.core.crud.query import Filter, ListSpec, parse_list_query
from app.core.crud.schemas import ErrorResponse, Page
from app.core.crud.service import CRUDService
from app.db import get_db


@dataclass
class CRUDConfig:
    prefix: str
    tags: list[str]
    model: type
    read_schema: type[BaseModel]
    create_schema: type[BaseModel]
    update_schema: type[BaseModel]
    service: type[CRUDService]
    current_user: Callable[..., Any]
    permissions: Mapping[str, Perm]
    filters: Sequence[Filter] = ()
    search_fields: Sequence[str] = ()
    sortable_fields: Sequence[str] = ()
    default_sort: str = "-id"
    default_limit: int = 12
    max_limit: int = 100
    disabled_actions: Sequence[str] = field(default_factory=tuple)

    def list_spec(self) -> ListSpec:
        return ListSpec(
            model=self.model,
            filters=self.filters,
            search_fields=self.search_fields,
            sortable_fields=self.sortable_fields,
            default_sort=self.default_sort,
            default_limit=self.default_limit,
            max_limit=self.max_limit,
        )


def _error_responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    text = {
        400: "Bad request, for example an unknown filter or sort field",
        401: "Not signed in",
        403: "Not allowed for this role",
        404: "Not found",
        409: "Conflicts with existing data",
        422: "Validation failed",
    }
    return {code: {"model": ErrorResponse, "description": text[code]} for code in codes}


def _query_param(name: str, description: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": name, "in": "query", "required": False,
        "description": description, "schema": schema,
    }


def _list_parameters(config: CRUDConfig) -> list[dict[str, Any]]:
    params = [
        _query_param("page", "Page number, starting at 1", {"type": "integer", "minimum": 1, "default": 1}),
        _query_param(
            "limit", f"Items per page, at most {config.max_limit}",
            {"type": "integer", "minimum": 1, "maximum": config.max_limit, "default": config.default_limit},
        ),
        _query_param(
            "sort",
            f"Sort field, prefix with - for descending. Allowed: {', '.join(config.sortable_fields)}",
            {"type": "string", "default": config.default_sort},
        ),
    ]
    if config.search_fields:
        params.append(_query_param(
            "q", f"Case insensitive search in: {', '.join(config.search_fields)}", {"type": "string"}
        ))
    for flt in config.filters:
        for name in flt.params():
            params.append(_query_param(name, f"Filter ({type(flt).__name__.lower()})", {"type": "string"}))
    return params


def crud_router(config: CRUDConfig) -> APIRouter:
    router = APIRouter(prefix=config.prefix, tags=config.tags)
    read_schema = config.read_schema
    create_schema = config.create_schema
    update_schema = config.update_schema
    spec = config.list_spec()
    disabled = set(config.disabled_actions)
    unknown = disabled - set(ACTIONS)
    if unknown:
        raise ValueError(f"Unknown actions in disabled_actions: {sorted(unknown)}")
    noun = config.tags[0].lower() if config.tags else "item"

    def get_service(db: Session = Depends(get_db)) -> CRUDService:
        return config.service(db, config.permissions)

    def out(service: CRUDService, obj: Any, user: Any) -> BaseModel:
        return read_schema.model_validate(service.present(obj, user), from_attributes=True)

    def blocked(action: str):
        def handler():
            raise MethodNotAllowed(f"{action.capitalize()} is not available for {noun}")
        return handler

    # list

    if "list" in disabled:
        router.add_api_route("/", blocked("list"), methods=["GET"], include_in_schema=False)
    else:
        @router.get(
            "/", response_model=Page[read_schema], summary=f"List {noun}",
            responses=_error_responses(400, 401, 403),
            openapi_extra={"parameters": _list_parameters(config)},
        )
        def list_items(
            request: Request,
            user=Depends(config.current_user),
            service: CRUDService = Depends(get_service),
        ):
            query = parse_list_query(request.query_params, spec)
            items, total = service.list(user, query)
            presented = service.present_many(items, user)
            return {
                "items": [read_schema.model_validate(p, from_attributes=True) for p in presented],
                "page": query.page,
                "limit": query.limit,
                "total": total,
                "pages": math.ceil(total / query.limit),
            }

    # create

    if "create" in disabled:
        router.add_api_route("/", blocked("create"), methods=["POST"], include_in_schema=False)
    else:
        @router.post(
            "/", response_model=read_schema, status_code=201, summary=f"Create {noun}",
            responses=_error_responses(400, 401, 403, 409, 422),
        )
        def create_item(
            payload: create_schema,
            user=Depends(config.current_user),
            service: CRUDService = Depends(get_service),
            db: Session = Depends(get_db),
        ):
            obj = service.create(user, payload)
            result = out(service, obj, user)
            db.commit()
            return result

    # read

    if "read" in disabled:
        router.add_api_route("/{id}", blocked("read"), methods=["GET"], include_in_schema=False)
    else:
        @router.get(
            "/{id}", response_model=read_schema, summary=f"Get {noun} by id",
            responses=_error_responses(401, 403, 404),
        )
        def read_item(
            id: int,
            user=Depends(config.current_user),
            service: CRUDService = Depends(get_service),
        ):
            return out(service, service.get(user, id), user)

    # update (PUT and PATCH both merge only the fields that are sent)

    if "update" in disabled:
        router.add_api_route("/{id}", blocked("update"), methods=["PUT", "PATCH"], include_in_schema=False)
    else:
        def _update(id: int, payload, user, service, db):
            obj = service.update(user, id, payload)
            result = out(service, obj, user)
            db.commit()
            return result

        @router.put(
            "/{id}", response_model=read_schema, summary=f"Update {noun}",
            responses=_error_responses(400, 401, 403, 404, 409, 422),
        )
        def replace_item(
            id: int,
            payload: update_schema,
            user=Depends(config.current_user),
            service: CRUDService = Depends(get_service),
            db: Session = Depends(get_db),
        ):
            return _update(id, payload, user, service, db)

        @router.patch(
            "/{id}", response_model=read_schema, summary=f"Partially update {noun}",
            responses=_error_responses(400, 401, 403, 404, 409, 422),
        )
        def patch_item(
            id: int,
            payload: update_schema,
            user=Depends(config.current_user),
            service: CRUDService = Depends(get_service),
            db: Session = Depends(get_db),
        ):
            return _update(id, payload, user, service, db)

    # delete

    if "delete" in disabled:
        router.add_api_route("/{id}", blocked("delete"), methods=["DELETE"], include_in_schema=False)
    else:
        @router.delete(
            "/{id}", status_code=204, summary=f"Delete {noun}",
            responses=_error_responses(401, 403, 404, 409),
        )
        def delete_item(
            id: int,
            user=Depends(config.current_user),
            service: CRUDService = Depends(get_service),
            db: Session = Depends(get_db),
        ):
            service.delete(user, id)
            db.commit()
            return Response(status_code=204)

    return router
