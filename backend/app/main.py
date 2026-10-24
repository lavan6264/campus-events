from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.crud import install_error_handlers
from app.domain import auth, event_registration, me
from app.resources.events import router as events
from app.resources.registrations import router as registrations
from app.resources.users import router as users


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Campus Events API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["health"], summary="Health check")
    def health():
        return {"status": "ok"}

    api.include_router(auth.router)
    # Domain routers that share a prefix with a generated router must be included first,
    # so fixed paths such as /events/categories win over /events/{id}.
    api.include_router(users.router)
    api.include_router(event_registration.router)
    api.include_router(me.router)
    api.include_router(events.router)
    api.include_router(registrations.router)

    app.include_router(api)
    return app


app = create_app()
