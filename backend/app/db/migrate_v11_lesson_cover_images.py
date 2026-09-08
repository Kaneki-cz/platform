"""One-time migration for lecture cover images — lets a lecture show up as a
poster card (cover art + title), the same visual treatment
app/(tabs)/courses/[subjectId]/index.tsx already gives chapters via
Course.cover_image_url. See app/models/lesson.py's cover_image_url comment.

Adds:
- lessons.cover_image_url (nullable TEXT) — same storage convention as
  Lesson.video_url / Course.cover_image_url (real http(s) link / legacy
  relative /media/ path / private "b2:<key>" marker), cleaned up from R2 on
  replace/delete via b2_storage.delete_object_for_url (see
  app/api/routes/lessons.py).

Safe to run on either an existing or a brand-new database — only adds the
column if it's missing, and is safe to re-run. Independent of every other
migrate_v* script.

Usage:
    python -m app.db.migrate_v11_lesson_cover_images
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    if "lessons" not in tables:
        print("lessons table doesn't exist yet — run `python -m app.db.init_db` first.")
        return

    if not _column_exists("lessons", "cover_image_url"):
        print("Adding lessons.cover_image_url ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE lessons ADD COLUMN cover_image_url TEXT"))
    else:
        print("lessons.cover_image_url already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
