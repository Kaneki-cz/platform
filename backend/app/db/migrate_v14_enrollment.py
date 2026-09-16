"""One-time migration for student enrollment + teacher groups.

Adds:
  - users.full_name_ar  (VARCHAR 255, nullable) — student's Arabic full name
  - users.grade         (VARCHAR 100, nullable) — grade level (fixed options)
  - teacher_groups table      — groups a teacher creates for their students
  - student_group_memberships — one row per (student, teacher) pair

Safe to run on either an existing or brand-new database — only adds what's
missing, and is safe to re-run. Independent of every other migration.

Usage:
    python -m app.db.migrate_v14_enrollment
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def _table_exists(table: str) -> bool:
    return table in set(inspect(engine).get_table_names())


def migrate() -> None:
    # ── 1. Add full_name_ar + grade to users ─────────────────────────────────
    if not _column_exists("users", "full_name_ar"):
        print("Adding users.full_name_ar ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN full_name_ar VARCHAR(255)"))
    else:
        print("users.full_name_ar already present, skipping.")

    if not _column_exists("users", "grade"):
        print("Adding users.grade ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN grade VARCHAR(100)"))
    else:
        print("users.grade already present, skipping.")

    # ── 2. Create teacher_groups table ────────────────────────────────────────
    if not _table_exists("teacher_groups"):
        print("Creating teacher_groups table ...")
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE teacher_groups (
                        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        teacher_id   UUID        NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
                        name         VARCHAR(255) NOT NULL,
                        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(
                text("CREATE INDEX idx_teacher_groups_teacher_id ON teacher_groups(teacher_id)")
            )
    else:
        print("teacher_groups table already present, skipping.")

    # ── 3. Create student_group_memberships table ─────────────────────────────
    if not _table_exists("student_group_memberships"):
        print("Creating student_group_memberships table ...")
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE student_group_memberships (
                        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        student_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        teacher_id       UUID        NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
                        group_id         UUID        REFERENCES teacher_groups(id) ON DELETE SET NULL,
                        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT uq_student_teacher UNIQUE (student_user_id, teacher_id)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX idx_sgm_student ON student_group_memberships(student_user_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX idx_sgm_teacher ON student_group_memberships(teacher_id)"
                )
            )
    else:
        print("student_group_memberships table already present, skipping.")

    print("Migration v14 complete.")


if __name__ == "__main__":
    migrate()
