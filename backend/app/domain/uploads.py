"""Image uploads for event covers. Files are checked by their content, not by what the browser says."""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile
from pydantic import BaseModel

from app.config import get_settings
from app.core.crud import BadRequest, ErrorResponse
from app.deps import require_roles
from app.resources.users.models import User

router = APIRouter(prefix="/uploads", tags=["Uploads"])

MAX_BYTES = 2 * 1024 * 1024
# SVG is left out on purpose: it can carry scripts.
SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"\xff\xd8\xff", ".jpg"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
)


class UploadResult(BaseModel):
    url: str


def detect_extension(data: bytes) -> str | None:
    for prefix, extension in SIGNATURES:
        if data.startswith(prefix):
            return extension
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def upload_dir() -> Path:
    path = Path(get_settings().upload_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


@router.post(
    "/event-image", response_model=UploadResult, status_code=201, summary="Upload a cover image for an event",
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
async def upload_event_image(file: UploadFile, _: User = Depends(require_roles("faculty", "admin"))):
    """PNG, JPEG, GIF or WebP, up to 2 MB. Returns a link to use as the event's `image_url`."""
    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise BadRequest("The file is empty", {"file": "Choose an image"})
    if len(data) > MAX_BYTES:
        raise BadRequest("The image is larger than 2 MB", {"file": "Use an image under 2 MB"})
    extension = detect_extension(data)
    if extension is None:
        raise BadRequest("Use a PNG, JPEG, GIF or WebP image", {"file": "Not a supported image"})
    name = f"{uuid.uuid4().hex}{extension}"
    (upload_dir() / name).write_bytes(data)
    return UploadResult(url=f"/api/uploads/{name}")
