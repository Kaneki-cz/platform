"""One-time migration for video skip/cheat tracking.

Adds:
  - lesson_progress.skip_count       (INTEGER, NOT NULL, default 0)
  - lesson_progress.skipped_seconds  (INTEGER, NOT NULL, default 0)

These back the Teacher Dashboard's "who's just running through the video"
flag — see app/models/progress.py's LessonProgress and the new
POST /api/v1/progress/skip endpoint (app/api/routes/progress.py), called
from the mobile player whenever it detects a forward jump too big to be
normal playback.

Safe to run on either an existing or brand-new database — only adds what's
missing, and is safe to re-run. Independent of every other migration.

Usage:
    python -m app.db.migrate_v15_video_skip_tracking
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    if not _column_exists("lesson_progress", "skip_count"):
        print("Adding lesson_progress.skip_count ...")
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE lesson_progress ADD COLUMN skip_count INTEGER NOT NULL DEFAULT 0")
            )
    else:
        print("lesson_progress.skip_count already present, skipping.")

    if not _column_exists("lesson_progress", "skipped_seconds"):
        print("Adding lesson_progress.skipped_seconds ...")
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE lesson_progress ADD COLUMN skipped_seconds INTEGER NOT NULL DEFAULT 0")
            )
    else:
        print("lesson_progress.skipped_seconds already present, skipping.")

    print("Migration v15 complete.")


if __name__ == "__main__":
    migrate()
