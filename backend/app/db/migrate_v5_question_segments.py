"""One-time migration: adds questions.pause_at_seconds to an existing
database — lets a lecture's video be split into "parts", each ending in a
mini quiz shown at that timestamp (see app/models/question.py's
pause_at_seconds and app/api/routes/questions.py). Every question sharing
the same pause_at_seconds value belongs to the same part; NULL means "no
specific pause point" (shown once the video ends instead).

Safe to run on either an existing or a brand-new database — only adds
what's missing, and is safe to re-run. Independent of the other migrate_v*
scripts — run them in any order.

Usage:
    python -m app.db.migrate_v5_question_segments
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    inspector = inspect(engine)
    if "questions" not in set(inspector.get_table_names()):
        print("questions table doesn't exist yet — run `python -m app.db.init_db` first.")
        return

    if not _column_exists("questions", "pause_at_seconds"):
        print("Adding questions.pause_at_seconds ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE questions ADD COLUMN pause_at_seconds INTEGER"))
    else:
        print("questions.pause_at_seconds already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
