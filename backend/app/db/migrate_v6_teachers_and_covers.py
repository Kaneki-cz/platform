"""One-time migration for the "browse by teacher/grade, side-by-side
chapters with cover images" feature.

Creates the new teacher_profiles table (display-card teachers, see
app/models/teacher.py — NOT real user accounts, unrelated to
subject_instructors) and adds courses.teacher_id + courses.cover_image_url
to an existing database.

Safe to run on either an existing or a brand-new database — only adds
what's missing, and is safe to re-run. Independent of the other migrate_v*
scripts — run them in any order.

Usage:
    python -m app.db.migrate_v6_teachers_and_covers
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _table_exists(table: str) -> bool:
    return table in set(inspect(engine).get_table_names())


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    if "subjects" not in set(inspect(engine).get_table_names()):
        print("subjects table doesn't exist yet — run `python -m app.db.init_db` first.")
        return

    if not _table_exists("teacher_profiles"):
        print("Creating teacher_profiles table ...")
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE teacher_profiles (
                        id UUID PRIMARY KEY,
                        subject_id UUID NOT NULL REFERENCES subjects(id),
                        name VARCHAR(255) NOT NULL,
                        photo_url VARCHAR(500),
                        order_index INTEGER DEFAULT 0,
                        created_at TIMESTAMPTZ DEFAULT now()
                    )
                    """
                )
            )
    else:
        print("teacher_profiles already present, skipping.")

    if not _column_exists("courses", "teacher_id"):
        print("Adding courses.teacher_id ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE courses ADD COLUMN teacher_id UUID REFERENCES teacher_profiles(id)"))
    else:
        print("courses.teacher_id already present, skipping.")

    if not _column_exists("courses", "cover_image_url"):
        print("Adding courses.cover_image_url ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE courses ADD COLUMN cover_image_url VARCHAR(500)"))
    else:
        print("courses.cover_image_url already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
