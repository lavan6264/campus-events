from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.core.crud import install_error_handlers
from app.domain import admin, ai, auth, event_registration, me, uploads
from app.resources.events import router as events
from app.resources.registrations import router as registrations
from app.resources.users import router as users


class UploadFiles(StaticFiles):
    """Serves uploaded images. nosniff stops a browser from treating a file as anything but an image."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "public, max-age=86400"
        response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        return response


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
    api.include_router(admin.router)
    api.include_router(ai.router)
    api.include_router(ai.admin_router)
    api.include_router(uploads.router)
    api.include_router(events.router)
    api.include_router(registrations.router)

    app.include_router(api)
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    app.mount("/api/uploads", UploadFiles(directory=settings.upload_dir), name="uploads")
    return app


app = create_app()
