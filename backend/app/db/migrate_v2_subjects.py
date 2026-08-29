"""One-time migration: adds Subjects + user roles to an existing database.

Safe to run on either an existing (already has data) or a brand-new
database — it only touches what's missing, and is safe to re-run.
If you've never run `init_db.py` before, you don't need this at all; a
fresh database already gets the final schema straight away.

What it does, in order, only for pieces that don't already exist:
  1. Adds `users.role` (defaults existing rows to 'student').
  2. Creates the `subjects` and `subject_instructors` tables.
  3. Adds `courses.subject_id`, backfills every existing course onto a new
     "Physics" subject (so nothing you already created disappears), then
     makes the column NOT NULL with its foreign key.

Usage:
    python -m app.db.migrate_v2_subjects
"""
from sqlalchemy import inspect, text

from app.db.database import Base, SessionLocal, engine
from app.models import *  # noqa: F401,F403 — register metadata
from app.models.subject import Subject


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if "users" in existing_tables and not _column_exists("users", "role"):
        print("Adding users.role ...")
        with engine.begin() as conn:
            conn.execute(text("CREATE TYPE userrole AS ENUM ('student', 'instructor', 'admin')"))
            conn.execute(text("ALTER TABLE users ADD COLUMN role userrole NOT NULL DEFAULT 'student'"))
    else:
        print("users.role already present, skipping.")

    print("Creating any missing tables (subjects, subject_instructors, ...) ...")
    Base.metadata.create_all(bind=engine)

    if "courses" in existing_tables and not _column_exists("courses", "subject_id"):
        print("Adding courses.subject_id and backfilling existing courses onto a 'Physics' subject ...")
        db = SessionLocal()
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE courses ADD COLUMN subject_id UUID"))

            physics = db.query(Subject).filter(Subject.name == "Physics").first()
            if not physics:
                physics = Subject(name="Physics", order_index=1)
                db.add(physics)
                db.commit()
                db.refresh(physics)

            with engine.begin() as conn:
                conn.execute(
                    text("UPDATE courses SET subject_id = :sid WHERE subject_id IS NULL"),
                    {"sid": str(physics.id)},
                )
                conn.execute(text("ALTER TABLE courses ALTER COLUMN subject_id SET NOT NULL"))
                conn.execute(
                    text(
                        "ALTER TABLE courses ADD CONSTRAINT courses_subject_id_fkey "
                        "FOREIGN KEY (subject_id) REFERENCES subjects(id)"
                    )
                )
        finally:
            db.close()
    else:
        print("courses.subject_id already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
