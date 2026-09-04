"""One-time migration for the "per-lecture view limit" feature.

Adds lessons.max_views (NULL = unlimited — the default for every lesson
that existed before this feature, so nothing suddenly gets capped) plus
lesson_progress.view_count and lesson_progress.bonus_views (both default 0).
See app/models/lesson.py and app/models/progress.py for what each column
means, and app/api/routes/lessons.py's get_lesson for how they're enforced.

Safe to run on either an existing or a brand-new database — only adds
what's missing, and is safe to re-run. Independent of the other migrate_v*
scripts — run them in any order.

Usage:
    python -m app.db.migrate_v7_view_limits
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    if "lessons" not in tables or "lesson_progress" not in tables:
        print("lessons/lesson_progress tables don't exist yet — run `python -m app.db.init_db` first.")
        return

    if not _column_exists("lessons", "max_views"):
        print("Adding lessons.max_views ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE lessons ADD COLUMN max_views INTEGER"))
    else:
        print("lessons.max_views already present, skipping.")

    if not _column_exists("lesson_progress", "view_count"):
        print("Adding lesson_progress.view_count ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE lesson_progress ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0"))
    else:
        print("lesson_progress.view_count already present, skipping.")

    if not _column_exists("lesson_progress", "bonus_views"):
        print("Adding lesson_progress.bonus_views ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE lesson_progress ADD COLUMN bonus_views INTEGER NOT NULL DEFAULT 0"))
    else:
        print("lesson_progress.bonus_views already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
