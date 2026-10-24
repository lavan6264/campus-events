"""Error types and the handlers that give every endpoint the same error shape.

Shape: {"error": "message", "fields": {"email": "Already in use"}}
`fields` is present only for validation and constraint errors.
"""
import re
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    status_code = 400

    def __init__(self, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.message = message
        self.fields = fields


class BadRequest(AppError):
    status_code = 400


class Unauthorized(AppError):
    status_code = 401


class Forbidden(AppError):
    status_code = 403


class NotFound(AppError):
    status_code = 404


class MethodNotAllowed(AppError):
    status_code = 405


class Conflict(AppError):
    status_code = 409


class Unprocessable(AppError):
    status_code = 422


# Friendly text for named database constraints: name -> (field, message).
_CONSTRAINT_MESSAGES: dict[str, tuple[str, str]] = {}


def register_constraint_message(constraint: str, field: str, message: str) -> None:
    _CONSTRAINT_MESSAGES[constraint] = (field, message)


def _body(message: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"error": message}
    if fields:
        body["fields"] = fields
    return body


def _label(field: str) -> str:
    return field.replace("_", " ").capitalize()


def _fields_from_detail(detail: str | None) -> list[str]:
    match = re.search(r"Key \((.+?)\)=", detail or "")
    return [part.strip() for part in match.group(1).split(",")] if match else []


def integrity_error_response(exc: IntegrityError) -> tuple[int, dict[str, Any]]:
    orig = exc.orig
    diag = getattr(orig, "diag", None)
    sqlstate = getattr(orig, "sqlstate", None)
    constraint = getattr(diag, "constraint_name", None)
    detail = getattr(diag, "message_detail", None)

    if constraint in _CONSTRAINT_MESSAGES:
        field, message = _CONSTRAINT_MESSAGES[constraint]
        status = 409 if sqlstate == "23505" else 422
        return status, _body(f"{_label(field)}: {message}", {field: message})

    columns = _fields_from_detail(detail)
    if sqlstate == "23505":
        fields = {c: "Already in use" for c in columns}
        label = _label(columns[0]) if len(columns) == 1 else "This record"
        return 409, _body(f"{label} already in use" if len(columns) == 1 else "Already exists", fields)
    if sqlstate == "23503":
        if "is not present in table" in (detail or ""):
            fields = {c: "Does not exist" for c in columns}
            return 422, _body("Refers to a record that does not exist", fields)
        return 409, _body("Cannot change this record because other records depend on it")
    if sqlstate == "23502":
        column = getattr(diag, "column_name", None)
        fields = {column: "Required"} if column else None
        return 422, _body("A required value is missing", fields)
    if sqlstate == "23514":
        return 422, _body("A value is outside the allowed range")
    return 409, _body("The change conflicts with existing data")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(_body(exc.message, exc.fields), status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        if exc.status_code == 404 and message == "Not Found":
            message = "Not found"
        return JSONResponse(_body(message), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(p) for p in err["loc"] if p not in ("body", "query", "path")]
            key = ".".join(loc) or "request"
            message = err["msg"].removeprefix("Value error, ")
            fields.setdefault(key, message)
        return JSONResponse(_body("Please fix the highlighted fields", fields), status_code=422)

    @app.exception_handler(IntegrityError)
    async def integrity(_: Request, exc: IntegrityError):
        status, body = integrity_error_response(exc)
        return JSONResponse(body, status_code=status)


__all__ = [
    "AppError", "BadRequest", "Conflict", "Forbidden", "MethodNotAllowed",
    "NotFound", "Unauthorized", "Unprocessable", "install_error_handlers",
    "integrity_error_response", "register_constraint_message",
]
