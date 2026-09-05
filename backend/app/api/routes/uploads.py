"""Video AND image upload endpoints.

Lets instructors/admins get a lecture video, teacher photo, or chapter
cover image into the app, either by pasting an external link (video only —
YouTube etc.) or by uploading a file from their device.

Uploaded files go to Backblaze B2 (see app/services/b2_storage.py) when
B2_* is configured in .env. Crucially, the upload goes DIRECTLY from the
admin's own device to B2 — POST /upload-url just hands out a short-lived
presigned PUT URL, it never sees the file's bytes itself. That matters
because this backend server's own home-internet upload speed was measured
at ~0.91 Mbit/s: if the file were proxied through this server on its way to
B2 (an earlier version of this endpoint did exactly that, for video), it
would cross that same slow uplink twice (once in from the admin, once back
out to B2) — the exact bottleneck this whole B2 migration exists to avoid.
A direct-to-B2 upload never touches this server's connection at all. This
applies just as much to teacher/cover photos as it does to videos, even
though photos are much smaller — no reason to reintroduce the proxy path
for a new file kind.

When B2 isn't configured (e.g. local dev without a B2 account), POST
/upload-url instead tells the app to fall back to the original proxy-upload
endpoint, POST /video (video only — image proxy upload was never needed
since this feature was built B2-first), which stores straight to this
server's own local disk under backend/media/videos (served back out by
main.py's "/media" static mount) — fine for local development, where
there's no home-internet bottleneck to worry about.

The B2 bucket is PRIVATE, so a B2-backed file's URL is NOT a playable/
loadable link by itself — it's `b2:<object key>`, a marker the mobile app
recognizes (see lib/api.ts's resolveVideoUrl / resolveFileUrl) and
exchanges for a short-lived signed *read* URL via GET /video-url right
before use (a separate, read-only signed URL from the upload one above).
That endpoint name is a holdover from video-only days but it's genuinely
generic — any object key works, image or video.
"""
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.api.deps import get_current_user, require_instructor_or_admin
from app.models.user import User
from app.services import b2_storage

router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])

# backend/app/api/routes/uploads.py -> parents[3] == backend/
MEDIA_ROOT = Path(__file__).resolve().parents[3] / "media" / "videos"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_EXTENSIONS = VIDEO_EXTENSIONS  # kept as the old name for the video-only proxy path below
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB safety cap
CHUNK_SIZE = 1024 * 1024  # 1 MB

CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

EXTENSIONS_BY_KIND = {"video": VIDEO_EXTENSIONS, "image": IMAGE_EXTENSIONS}
KEY_PREFIX_BY_KIND = {"video": b2_storage.VIDEO_KEY_PREFIX, "image": b2_storage.IMAGE_KEY_PREFIX}


class UploadUrlRequest(BaseModel):
    file_name: str
    content_type: str
    kind: Literal["video", "image"] = "video"


@router.post("/upload-url")
async def create_upload_url(
    payload: UploadUrlRequest,
    _current_user: User = Depends(require_instructor_or_admin),
) -> dict:
    """First step of uploading a video or image file. Returns either:
      - {"mode": "direct", "upload_url": ..., "file_url": "b2:..."} — the
        app should PUT the raw file bytes straight to `upload_url` (no auth
        header needed, the signature in the URL is the auth), then save
        `file_url` as-is once that PUT succeeds.
      - {"mode": "proxy"} — B2 isn't configured on this server; for video,
        the app should fall back to the original multipart upload at
        POST /video. Images have no proxy fallback (B2-only feature).
    """
    if not b2_storage.b2_configured():
        return {"mode": "proxy"}

    allowed = EXTENSIONS_BY_KIND[payload.kind]
    ext = Path(payload.file_name).suffix.lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {payload.kind} type {ext or '(unknown)'}. Allowed: {', '.join(sorted(allowed))}",
        )

    object_key = f"{KEY_PREFIX_BY_KIND[payload.kind]}{uuid.uuid4().hex}{ext}"
    content_type = CONTENT_TYPES.get(ext, payload.content_type or "application/octet-stream")
    try:
        upload_url = b2_storage.generate_upload_url(object_key, content_type)
    except Exception as e:  # noqa: BLE001 - surface any storage-side failure to the admin
        raise HTTPException(status_code=502, detail=f"Could not prepare upload: {e}") from e

    return {
        "mode": "direct",
        "upload_url": upload_url,
        "content_type": content_type,
        "file_url": f"{b2_storage.B2_URL_SCHEME}{object_key}",
    }


@router.post("/video")
async def upload_video(
    file: UploadFile = File(...),
    _current_user: User = Depends(require_instructor_or_admin),
) -> dict:
    """Local-disk fallback proxy upload — only used by the app when
    POST /upload-url reported {"mode": "proxy"} (B2 not configured).
    Unchanged from before B2 existed."""
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


@router.delete("/object", status_code=204)
async def discard_uploaded_object(
    url: str = Query(..., description="A b2:<key> value to delete — see the admin app's discardIfUnsaved."),
    _current_user: User = Depends(require_instructor_or_admin),
) -> None:
    """Lets the admin app clean up a file it already uploaded straight to
    R2/B2 but never actually saved to a lesson/teacher/course — e.g. the
    admin picked a video, then picked ANOTHER one before hitting Save, or
    backed out of editing altogether. Without this, that first upload has
    no lesson/teacher/course pointing at it for the delete/replace cleanup
    in app/services/b2_storage.py (delete_object_for_url, called from
    lessons.py/teachers.py/courses.py) to ever catch, so it would sit in
    the bucket forever.

    Best-effort and deliberately permissive: does nothing (not an error)
    for a URL that isn't a b2:<key> at all (an external link — there's
    nothing of ours to delete) or if B2 isn't configured.
    """
    b2_storage.delete_object_for_url(url)
