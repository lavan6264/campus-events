from app.core.crud import CRUDConfig, Exact, InSet, Perm, Range, crud_router
from app.deps import get_current_user
from app.resources.registrations.models import Registration
from app.resources.registrations.schemas import RegistrationCreate, RegistrationRead, RegistrationUpdate
from app.resources.registrations.service import RegistrationService

admin_only = Perm(roles=("admin",))

router = crud_router(CRUDConfig(
    prefix="/registrations",
    tags=["Registrations"],
    model=Registration,
    read_schema=RegistrationRead,
    create_schema=RegistrationCreate,
    update_schema=RegistrationUpdate,
    service=RegistrationService,
    current_user=get_current_user,
    permissions={"list": admin_only, "read": admin_only, "delete": admin_only},
    filters=[
        Exact("event_id"), Exact("user_id"), Exact("status"), InSet("status"), Range("created_at"),
    ],
    sortable_fields=["created_at", "updated_at", "status", "event_id", "user_id"],
    default_sort="-created_at",
    # Creating and cancelling need locking, waitlist and clash rules, so they live in
    # the domain endpoints: POST and DELETE /events/{id}/register.
    disabled_actions=("create", "update"),
))
