"""One-time migration for question images (diagrams accompanying a physics
problem — segment-quiz questions AND standalone-exam questions, since both
kinds share the same `questions` table, see app/models/question.py).

Adds:
- questions.image_url (nullable TEXT) — same storage convention as
  Lesson.video_url (real http(s) link / legacy relative /media/ path /
  private "b2:<key>" marker), cleaned up from R2 on replace/delete via
  b2_storage.delete_object_for_url (see app/api/routes/questions.py).

Safe to run on either an existing or a brand-new database — only adds the
column if it's missing, and is safe to re-run. Independent of every other
migrate_v* script.

Usage:
    python -m app.db.migrate_v10_question_images
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    if "questions" not in tables:
        print("questions table doesn't exist yet — run `python -m app.db.init_db` first.")
        return

    if not _column_exists("questions", "image_url"):
        print("Adding questions.image_url ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE questions ADD COLUMN image_url TEXT"))
    else:
        print("questions.image_url already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
