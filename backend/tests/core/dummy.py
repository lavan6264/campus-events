"""A dummy model and resource. They prove the framework needs no event, user or registration code."""
from datetime import datetime
from types import SimpleNamespace

from fastapi import FastAPI, Header
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.crud import (
    CRUDConfig, CRUDService, Custom, Exact, InSet, Perm, Range, Unauthorized,
    crud_router, install_error_handlers, owner,
)


class DummyBase(DeclarativeBase):
    pass


class Widget(DummyBase):
    __tablename__ = "dummy_widgets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    sku: Mapped[str] = mapped_column(String(40), unique=True)
    category: Mapped[str] = mapped_column(String(40))
    price: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WidgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sku: str
    category: str
    price: int
    active: bool
    owner_id: int
    created_at: datetime


class WidgetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sku: str = Field(min_length=1, max_length=40)
    category: str
    price: int = Field(ge=0)
    active: bool = True


class WidgetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sku: str | None = None
    category: str | None = None
    price: int | None = Field(default=None, ge=0)
    active: bool | None = None


CALLS: list[str] = []


class WidgetService(CRUDService[Widget, WidgetCreate, WidgetUpdate]):
    model = Widget
    resource_name = "Widget"

    def authorize(self, action, user, obj=None):
        CALLS.append(f"authorize:{action}")
        super().authorize(action, user, obj)

    def before_create(self, data, user):
        CALLS.append("before_create")
        data["owner_id"] = user.id
        return data

    def after_create(self, obj, user):
        CALLS.append("after_create")

    def before_update(self, obj, data, user):
        CALLS.append("before_update")
        return data

    def after_update(self, obj, user):
        CALLS.append("after_update")

    def before_delete(self, obj, user):
        CALLS.append("before_delete")

    def after_delete(self, obj, user):
        CALLS.append("after_delete")


def current_user(x_role: str | None = Header(default=None), x_user_id: int | None = Header(default=None)):
    if not x_role:
        raise Unauthorized("Please sign in to continue")
    return SimpleNamespace(id=x_user_id or 1, role=x_role)


def _expensive(value: str):
    if value not in ("true", "false"):
        raise ValueError("Use true or false")
    return Widget.price >= 100 if value == "true" else Widget.price < 100


PERMISSIONS = {
    "list": Perm(),
    "read": Perm(),
    "create": Perm(roles=("staff", "admin")),
    "update": Perm(roles=("admin",), ownership=owner("owner_id")),
    "delete": Perm(roles=("admin",)),
}


def widget_config(prefix: str, disabled=()) -> CRUDConfig:
    return CRUDConfig(
        prefix=prefix,
        tags=["Widgets"],
        model=Widget,
        read_schema=WidgetRead,
        create_schema=WidgetCreate,
        update_schema=WidgetUpdate,
        service=WidgetService,
        current_user=current_user,
        permissions=PERMISSIONS,
        filters=[
            Exact("category"), Exact("active"), Range("price"), Range("created_at"),
            InSet("category"), Custom("expensive", _expensive),
        ],
        search_fields=["name", "sku"],
        sortable_fields=["name", "price", "created_at"],
        default_sort="name",
        default_limit=5,
        max_limit=10,
        disabled_actions=disabled,
    )


def build_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)
    app.include_router(crud_router(widget_config("/api/widgets")))
    app.include_router(crud_router(widget_config("/api/readonly-widgets", disabled=("create", "update", "delete"))))
    return app
