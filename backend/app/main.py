from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.crud import install_error_handlers


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

    app.include_router(api)
    return app


app = create_app()
