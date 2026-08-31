"""Video upload endpoint.

Lets instructors/admins upload a lecture video file directly from the app,
as an alternative to pasting an external link (a YouTube link, or now).

Uploaded files go to Backblaze B2 (see app/services/b2_storage.py) when
B2_* is configured in .env — the backend server's own home-internet upload
speed was measured at ~0.91 Mbit/s, far too slow to stream lecture video to
students directly, which is what made this move necessary. When B2 isn't
configured (e.g. local dev without a B2 account), this falls back to the
original local-disk storage under backend/media/videos, served back out by
main.py's "/media" static mount — exactly as before.

The B2 bucket is PRIVATE, so a B2-backed upload's `video_url` is NOT a
playable link by itself — it's `b2:<object key>`, a marker the mobile app
recognizes (see lib/api.ts's resolveVideoUrl) and exchanges for a short-lived
signed URL via GET /video-url below, right before playback.
"""
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.api.deps import get_current_user, require_instructor_or_admin
from app.models.user import User
from app.services import b2_storage

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

    if b2_storage.b2_configured():
        # Buffer to a temp file first rather than streaming straight into
        # boto3 — boto3's upload calls are synchronous, and UploadFile's
        # reads are async, so mixing them directly would block the event
        # loop mid-upload. A local temp file (deleted right after) keeps
        # this simple and is plenty fast for admin-only lecture uploads.
        object_key = f"{b2_storage.VIDEO_KEY_PREFIX}{filename}"
        size = 0
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp_path = Path(tmp.name)
            try:
                while chunk := await file.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="Video too large (max 500MB)")
                    tmp.write(chunk)
            except HTTPException:
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise
            finally:
                await file.close()

        try:
            b2_storage.upload_video_file(str(tmp_path), object_key)
        except Exception as e:  # noqa: BLE001 - surface any storage-side failure to the admin
            raise HTTPException(status_code=502, detail=f"Video storage upload failed: {e}") from e
        finally:
            tmp_path.unlink(missing_ok=True)

        return {"video_url": f"{b2_storage.B2_URL_SCHEME}{object_key}"}

    # --- Fallback: original local-disk storage (no B2 configured) ---
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
    return {"video_url": f"/media/videos/{filename}"}


@router.get("/video-url")
async def get_video_signed_url(
    key: str = Query(..., description="The object key portion of a b2:<key> video_url"),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """Exchanges a B2 object key for a short-lived signed playback URL.

    Any logged-in user (student, instructor, or admin) may call this — the
    same trust level the old public /media/videos/<uuid>.mp4 links had
    (unguessable filename, no per-lesson access check). Called by the
    mobile app's resolveVideoUrl right before a lecture's video starts
    playing, never stored — a fresh URL is requested every time a lesson
    opens.
    """
    if not b2_storage.b2_configured():
        raise HTTPException(status_code=503, detail="Video storage is not configured on this server.")
    try:
        url = b2_storage.generate_signed_video_url(key)
    except Exception as e:  # noqa: BLE001 - surface any storage-side failure to the app
        raise HTTPException(status_code=502, detail=f"Could not create a video link: {e}") from e
    return {"url": url}
