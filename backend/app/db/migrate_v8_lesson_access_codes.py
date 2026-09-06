"""One-time migration for the "per-lecture redemption code" feature.

Creates the lesson_access_codes table (see app/models/lesson_access_code.py)
— a lecture with no rows in it behaves exactly as before; generating codes
for a lecture (via POST /api/v1/lessons/{id}/codes) is what switches it into
"requires a code" mode going forward. Independent of every other feature —
nothing existing is touched.

Safe to run on either an existing or a brand-new database — only creates
the table if it's missing, and is safe to re-run.

Usage:
    python -m app.db.migrate_v8_lesson_access_codes
"""
from sqlalchemy import inspect

from app.db.database import Base, engine
from app.models.lesson_access_code import LessonAccessCode  # noqa: F401 — registers the table on Base.metadata


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    if "lessons" not in tables:
        print("lessons table doesn't exist yet — run `python -m app.db.init_db` first.")
        return

    if "lesson_access_codes" in tables:
        print("lesson_access_codes already present, skipping.")
        return

    print("Creating lesson_access_codes ...")
    Base.metadata.create_all(bind=engine, tables=[LessonAccessCode.__table__])
    print("Migration complete.")


if __name__ == "__main__":
    migrate()
