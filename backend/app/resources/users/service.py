from app.core.crud import CRUDService, Forbidden, register_constraint_message
from app.resources.users.models import User
from app.resources.users.schemas import UserCreate, UserUpdate
from app.security import hash_password

register_constraint_message("ck_users_role", "role", "Must be student, faculty or admin")


class UserService(CRUDService[User, UserCreate, UserUpdate]):
    model = User
    resource_name = "User"

    def before_create(self, data, user):
        data["password_hash"] = hash_password(data.pop("password"))
        return data

    def before_update(self, obj, data, user):
        if user.role != "admin":
            data.pop("email", None)  # only an admin changes someone's login email
        for required in ("name", "email"):
            if required in data and data[required] is None:
                del data[required]
        password = data.pop("password", None)
        if password:
            data["password_hash"] = hash_password(password)
        return data

    def before_delete(self, obj, user):
        if obj.id == user.id:
            raise Forbidden("You cannot delete your own account")
