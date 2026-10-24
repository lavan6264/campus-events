from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    page: int
    limit: int
    total: int
    pages: int


class ErrorResponse(BaseModel):
    error: str
    fields: dict[str, str] | None = None
