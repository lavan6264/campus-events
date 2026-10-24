from sqlalchemy import func, or_, select

from app.core.crud import CRUDConfig, Custom, Exact, InSet, Perm, Range, crud_router, owner
from app.deps import get_current_user
from app.resources.events.models import Event
from app.resources.events.schemas import EventCreate, EventRead, EventUpdate
from app.resources.events.service import EventService
from app.resources.users.models import User


def _organizer(value: str):
    """Matches an organizer id exactly, or part of an organizer's name."""
    value = value.strip()
    by_name = Event.organizer_id.in_(select(User.id).where(User.name.ilike(f"%{value}%")))
    if value.isdigit():
        return or_(Event.organizer_id == int(value), by_name)
    return by_name


def _upcoming(value: str):
    lowered = value.strip().lower()
    if lowered not in ("true", "false"):
        raise ValueError("Use true or false")
    return Event.start_time >= func.now() if lowered == "true" else Event.start_time < func.now()


router = crud_router(CRUDConfig(
    prefix="/events",
    tags=["Events"],
    model=Event,
    read_schema=EventRead,
    create_schema=EventCreate,
    update_schema=EventUpdate,
    service=EventService,
    current_user=get_current_user,
    permissions={
        "list": Perm(),
        "read": Perm(),
        "create": Perm(roles=("faculty", "admin")),
        "update": Perm(roles=("admin",), ownership=owner("organizer_id")),
        "delete": Perm(roles=("admin",), ownership=owner("organizer_id")),
    },
    filters=[
        Exact("category"), InSet("category"), Exact("venue"), Exact("status"), InSet("status"),
        Range("start_time"), Range("end_time"),
        Custom("organizer", _organizer), Custom("upcoming", _upcoming),
    ],
    search_fields=["title", "description", "venue"],
    sortable_fields=["start_time", "end_time", "title", "category", "capacity", "created_at"],
    default_sort="start_time",
))
