"""One-time migration for "instructors scoped to their own chapter(s)"
instead of a whole subject.

Adds teacher_profiles.user_id (see app/models/teacher.py) — optionally
links a real instructor account to a display-card teacher, which is what
now grants that account edit access to every chapter (Course) filed under
that teacher (app/api/deps.py's ensure_can_manage_course), replacing the
old subject-wide SubjectInstructor grant. SubjectInstructor itself (and its
table) is left completely untouched by this migration — it's simply no
longer consulted by any permission check going forward; nothing needs to be
migrated out of it since re-linking each real instructor to their chapter
via the new admin UI (subject screen -> teacher card -> link account) is a
one-time manual step the admin does after this deploys.

Safe to run on either an existing or a brand-new database — only adds
what's missing, and is safe to re-run. Independent of every other migration
(different column) — run in any order.

Usage:
    python -m app.db.migrate_v13_teacher_accounts
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    if "teacher_profiles" not in set(inspect(engine).get_table_names()):
        print("teacher_profiles table doesn't exist yet — run `python -m app.db.migrate_v6_teachers_and_covers` first.")
        return

    if not _column_exists("teacher_profiles", "user_id"):
        print("Adding teacher_profiles.user_id ...")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE teacher_profiles ADD COLUMN user_id UUID UNIQUE REFERENCES users(id)"
                )
            )
    else:
        print("teacher_profiles.user_id already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
