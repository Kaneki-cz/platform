"""One-off script: copies every object from the old Backblaze B2 bucket into
the new Cloudflare R2 bucket (keeping the exact same object keys), then
rewrites this server's own .env to point at R2 instead of B2.

Why this is needed: the database stores video/photo/cover URLs as
"b2:<object key>" markers (see app/services/b2_storage.py's B2_URL_SCHEME) —
that scheme name doesn't change just because the provider changed, but the
actual bytes for every key already uploaded (teacher photos, chapter
covers, lecture videos) only exist in the OLD B2 bucket. This script copies
them across AND flips the live .env in one run, so nothing needs typing on
a keyboard-only server terminal with no copy/paste — see the credentials
block below, filled in from the values already collected earlier in this
conversation (source: `cat .env | grep B2_` on kanekicz21, and the R2
bucket/token just created in the Cloudflare dashboard).

Usage — from backend/, inside the venv (same one run_prod.py uses):

    .venv/bin/python migrate_b2_to_r2.py

That's it — no environment variables, no flags. It prints progress as it
copies, rewrites .env at the very end (only after every object copied
successfully), and tells you to restart the server.

SECURITY NOTE: this file has real credentials hardcoded in it purely so it
can be typed/run with zero manual copy-pasting. Once you've run it
successfully once, DELETE this file (`rm migrate_b2_to_r2.py`) and consider
rotating the Backblaze B2 application key from the B2 dashboard, since it's
sitting in git history from here on. Not urgent — the app doesn't even use
this file — but worth doing next time you're in there.

Safe to re-run: it skips any key that already exists in the destination
bucket with a matching size, so an interrupted run can just be started
again instead of re-uploading everything from scratch. It only rewrites
.env if EVERY object copied with zero failures.
"""
import re
import sys
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

# --- Old bucket (Backblaze B2) — read straight off this server's own .env
# via `cat .env | grep B2_` earlier in this conversation. -------------------
SRC_KEY_ID = "0054044b5c358100000000001"
SRC_APPLICATION_KEY = "K005+Q8Nh6ApiL+iUdTr/RswBLRDWgg"
SRC_BUCKET_NAME = "physics-platform-videos"
SRC_ENDPOINT = "s3.us-east-005.backblazeb2.com"

# --- New bucket (Cloudflare R2) — from the R2 bucket + API token just
# created in the Cloudflare dashboard. --------------------------------------
DEST_KEY_ID = "2e959fa2c58edb4eb9c45dc27d10e761"
DEST_APPLICATION_KEY = "835b55ce5370987808c96a74f0a9a9f4540d16f6c0e893d703c4b5764d89500f"
DEST_BUCKET_NAME = "a-dash-final-project"
DEST_ACCOUNT_ID = "3fe4c7e2f6e7a4e54059855e4c3dfbaa"
DEST_ENDPOINT_HOST = f"{DEST_ACCOUNT_ID}.r2.cloudflarestorage.com"

ENV_PATH = Path(__file__).resolve().parent / ".env"


def update_env_file() -> None:
    """Rewrites B2_KEY_ID/B2_APPLICATION_KEY/B2_BUCKET_NAME/B2_ENDPOINT/
    B2_REGION in .env to the new R2 values — replacing each line in place if
    the key already exists, appending it otherwise, and leaving every other
    line (DATABASE_URL, SECRET_KEY, everything else) completely untouched.
    """
    new_values = {
        "B2_KEY_ID": DEST_KEY_ID,
        "B2_APPLICATION_KEY": DEST_APPLICATION_KEY,
        "B2_BUCKET_NAME": DEST_BUCKET_NAME,
        "B2_ENDPOINT": DEST_ENDPOINT_HOST,
        "B2_REGION": "auto",
    }

    if not ENV_PATH.exists():
        print(f"Could not find {ENV_PATH} — leaving it untouched. Set these by hand:")
        for k, v in new_values.items():
            print(f"  {k}={v}")
        return

    lines = ENV_PATH.read_text().splitlines()
    seen = set()
    for i, line in enumerate(lines):
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
        if match and match.group(1) in new_values:
            key = match.group(1)
            lines[i] = f"{key}={new_values[key]}"
            seen.add(key)

    for key, value in new_values.items():
        if key not in seen:
            lines.append(f"{key}={value}")

    ENV_PATH.write_text("\n".join(lines) + "\n")
    print(f"Updated {ENV_PATH} with the new R2 credentials.")


def main() -> None:
    src = boto3.client(
        "s3",
        endpoint_url=f"https://{SRC_ENDPOINT}",
        aws_access_key_id=SRC_KEY_ID,
        aws_secret_access_key=SRC_APPLICATION_KEY,
        config=Config(signature_version="s3v4"),
    )
    dest = boto3.client(
        "s3",
        endpoint_url=f"https://{DEST_ENDPOINT_HOST}",
        aws_access_key_id=DEST_KEY_ID,
        aws_secret_access_key=DEST_APPLICATION_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    print(f"Listing objects in source bucket '{SRC_BUCKET_NAME}'...")
    paginator = src.get_paginator("list_objects_v2")
    total = 0
    copied = 0
    skipped = 0
    failed: list[str] = []

    for page in paginator.paginate(Bucket=SRC_BUCKET_NAME):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            size = obj["Size"]
            total += 1

            try:
                existing = dest.head_object(Bucket=DEST_BUCKET_NAME, Key=key)
                if existing["ContentLength"] == size:
                    skipped += 1
                    continue
            except ClientError as e:
                if e.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                    raise

            try:
                body = src.get_object(Bucket=SRC_BUCKET_NAME, Key=key)["Body"]
                dest.upload_fileobj(body, DEST_BUCKET_NAME, key)
                copied += 1
                print(f"  copied ({copied}): {key} ({size} bytes)")
            except Exception as e:  # noqa: BLE001 - report and keep going
                failed.append(key)
                print(f"  FAILED: {key} — {e}", file=sys.stderr)

    print()
    print(f"Done. {total} objects found, {copied} copied, {skipped} already up to date, {len(failed)} failed.")

    if failed:
        print("Failed keys (re-run this script to retry them — .env was NOT changed):")
        for key in failed:
            print(f"  - {key}")
        sys.exit(1)

    update_env_file()
    print()
    print("All done. Now restart the server:  pkill -9 -f run_prod.py")


if __name__ == "__main__":
    main()
