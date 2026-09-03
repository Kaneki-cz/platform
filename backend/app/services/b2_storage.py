"""Object storage — via boto3's S3-compatible API, so this reads and writes
exactly like any other S3-compatible bucket. Originally written against
Backblaze B2 (hence the file/setting names), now pointed at Cloudflare R2
instead — see app/core/config.py's B2_* settings for the two providers'
different endpoint/region values. Nothing below needed to change to make
that switch: R2 speaks the same S3 API, presigned-URL mechanics included.

Videos live in a PRIVATE B2 bucket (see app/core/config.py's B2_* settings
for why: a free B2 account can't flip a bucket to Public without adding a
payment method, which is the whole reason this app moved off its own
too-slow home server in the first place — we didn't want to trade one blocker
for another). Because the bucket is private, nothing here hands out a
permanent link; instead, get_video_signed_url() below mints a short-lived
signed URL each time a student is about to watch a lecture. The mobile app
calls GET /api/v1/uploads/video-url for this — see
app/api/routes/uploads.py.
"""
from functools import lru_cache

import boto3
from botocore.client import Config

from app.core.config import settings

# How long a signed playback URL stays valid. Generous on purpose — a real
# lecture can run 45-60+ minutes, and the URL must stay valid for the whole
# time a student is watching (expo-video loads it once and streams from
# it; a URL expiring mid-playback would look exactly like the old
# self-hosting timeouts this migration was meant to fix). 6 hours comfortably
# covers even someone who opens a lecture and comes back to it later the
# same sitting.
SIGNED_URL_EXPIRES_SECONDS = 6 * 60 * 60

VIDEO_KEY_PREFIX = "videos/"
# Teacher photos and chapter cover images — same private-bucket, same
# signed-URL treatment as video, just a different key prefix for tidiness
# in the bucket listing. generate_upload_url/generate_signed_video_url
# below are already fully generic over object_key, so no other change was
# needed here to support images.
IMAGE_KEY_PREFIX = "images/"
# Marks a Lesson.video_url / TeacherProfile.photo_url / Course.cover_image_url
# value as "a B2 object key, not a real URL" — see resolveVideoUrl /
# resolveFileUrl on the mobile side (lib/api.ts), which branches on this
# prefix instead of treating it as an http(s) link or a local /media/ path.
B2_URL_SCHEME = "b2:"


def b2_configured() -> bool:
    """False when B2_* settings are unset — lets uploads.py fall back to the
    old local-disk storage for local dev without a B2 account."""
    return bool(settings.B2_KEY_ID and settings.B2_APPLICATION_KEY and settings.B2_BUCKET_NAME and settings.B2_ENDPOINT)


@lru_cache
def get_b2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.B2_ENDPOINT}",
        aws_access_key_id=settings.B2_KEY_ID,
        aws_secret_access_key=settings.B2_APPLICATION_KEY,
        config=Config(signature_version="s3v4"),
        region_name=settings.B2_REGION or None,
    )


def upload_video_file(local_path: str, object_key: str) -> None:
    get_b2_client().upload_file(local_path, settings.B2_BUCKET_NAME, object_key)


# How long a direct-upload URL stays valid. Needs to comfortably outlast a
# large lecture video (up to the 500MB cap) finishing its upload over
# whatever connection the admin's own device is on — an hour is generous
# even for a slow phone connection, and nothing bad happens if it's opened
# but not used (it just expires unused).
UPLOAD_URL_EXPIRES_SECONDS = 60 * 60


def generate_upload_url(object_key: str, content_type: str) -> str:
    """A presigned PUT URL the ADMIN'S OWN DEVICE uploads straight to,
    bypassing our backend entirely.

    This matters a lot here specifically: the backend runs on a home
    connection with a measured ~0.91 Mbit/s upload speed. If the app
    uploaded to our backend first and the backend then forwarded the file to
    B2 (the very first version of this feature did exactly that), every
    video would have to cross that same slow home uplink TWICE — once
    in, once back out — which is exactly the bottleneck this whole B2
    migration was meant to eliminate. A direct-to-B2 presigned URL means the
    video only ever travels from the admin's device to Backblaze's own
    servers, never touching this server's connection at all.
    """
    return get_b2_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.B2_BUCKET_NAME, "Key": object_key, "ContentType": content_type},
        ExpiresIn=UPLOAD_URL_EXPIRES_SECONDS,
    )


def generate_signed_video_url(object_key: str) -> str:
    return get_b2_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.B2_BUCKET_NAME, "Key": object_key},
        ExpiresIn=SIGNED_URL_EXPIRES_SECONDS,
    )
