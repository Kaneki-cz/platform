"""One-time migration for per-student QR codes + group attendance scanning.

Adds:
  - users.student_code    (VARCHAR 16, UNIQUE, nullable) — a student's
    permanent QR-code identifier, generated lazily the first time they open
    their own QR-code screen (see app/api/routes/attendance.py's
    get_or_create_student_code). NULL for every existing account until then.
  - attendance_records table — one row per (student, teacher group, day),
    created by a teacher/admin scanning a student's code.

Safe to run on either an existing or brand-new database — only adds what's
missing, and is safe to re-run. Independent of every other migration.

Usage:
    python -m app.db.migrate_v16_attendance
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def _table_exists(table: str) -> bool:
    return table in set(inspect(engine).get_table_names())


def migrate() -> None:
    # ── 1. Add users.student_code ─────────────────────────────────────────
    if not _column_exists("users", "student_code"):
        print("Adding users.student_code ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN student_code VARCHAR(16)"))
            conn.execute(
                text("CREATE UNIQUE INDEX idx_users_student_code ON users(student_code) WHERE student_code IS NOT NULL")
            )
    else:
        print("users.student_code already present, skipping.")

    # ── 2. Create attendance_records table ────────────────────────────────
    if not _table_exists("attendance_records"):
        print("Creating attendance_records table ...")
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE attendance_records (
                        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                        student_user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        group_id           UUID        NOT NULL REFERENCES teacher_groups(id) ON DELETE CASCADE,
                        session_date       DATE        NOT NULL,
                        scanned_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
                        scanned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT uq_attendance_student_group_day UNIQUE (student_user_id, group_id, session_date)
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX idx_attendance_student ON attendance_records(student_user_id)"))
            conn.execute(text("CREATE INDEX idx_attendance_group ON attendance_records(group_id)"))
    else:
        print("attendance_records table already present, skipping.")

    print("Migration v16 complete.")


if __name__ == "__main__":
    migrate()
