"""Video upload endpoint.

Lets instructors/admins upload a lecture video file directly from the app,
as an alternative to pasting an external link. Uploaded files are stored on
the backend server's own local disk (fine for local development — see
main.py's "/media" static mount) and the JSON response's `video_url` is
meant to be saved straight into a Lesson's `video_url` field, exactly like a
pasted link would be.
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.deps import require_instructor_or_admin
from app.models.user import User

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])

# backend/app/api/routes/uploads.py -> parents[3] == backend/
MEDIA_ROOT = Path(__file__).resolve().parents[3] / "media" / "videos"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB safety cap
CHUNK_SIZE = 1024 * 1024  # 1 MB


@router.post("/video")
async def upload_video(
    file: UploadFile = File(...),
    _current_user: User = Depends(require_instructor_or_admin),
) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported video type {ext or '(unknown)'}. "
                f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )

    filename = f"{uuid.uuid4().hex}{ext}"
    destination = MEDIA_ROOT / filename

    size = 0
    try:
        with destination.open("wb") as out_file:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Video too large (max 500MB)")
                out_file.write(chunk)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    # A RELATIVE path on purpose — not an absolute http://<ip>:8000/... URL.
    # The dev machine's LAN IP can change (new wifi, router reboot, etc.); a
    # relative path stays correct forever because the app resolves it
    # against whatever API host it's currently using (see
    # lib/api.ts::resolveVideoUrl), instead of the IP that happened to be
    # active at upload time.
    video_url = f"/media/videos/{filename}"
    return {"video_url": video_url}
