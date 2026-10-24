from app.core.crud import CRUDConfig, Exact, InSet, Perm, crud_router, owner
from app.deps import get_current_user
from app.resources.users.models import User
from app.resources.users.schemas import UserCreate, UserRead, UserUpdate
from app.resources.users.service import UserService

router = crud_router(CRUDConfig(
    prefix="/users",
    tags=["Users"],
    model=User,
    read_schema=UserRead,
    create_schema=UserCreate,
    update_schema=UserUpdate,
    service=UserService,
    current_user=get_current_user,
    permissions={
        "list": Perm(roles=("admin",)),
        "read": Perm(roles=("admin",), ownership=owner("id")),
        "create": Perm(roles=("admin",)),
        "update": Perm(roles=("admin",), ownership=owner("id")),
        "delete": Perm(roles=("admin",)),
    },
    filters=[Exact("role"), InSet("role"), Exact("department")],
    search_fields=["name", "email", "department"],
    sortable_fields=["name", "email", "role", "department", "created_at"],
    default_sort="name",
))
