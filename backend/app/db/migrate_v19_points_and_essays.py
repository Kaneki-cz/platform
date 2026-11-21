"""One-time migration for per-question points and teacher-graded essays.

Adds to `questions`:
  - points  INTEGER NOT NULL DEFAULT 1   (existing questions stay worth 1)

Adds to `question_attempts`:
  - points_awarded       DOUBLE PRECISION NULL
  - needs_review         BOOLEAN NOT NULL DEFAULT FALSE
  - reviewed_at          TIMESTAMPTZ NULL
  - reviewed_by_user_id  UUID NULL -> users(id) ON DELETE SET NULL
  - teacher_comment      TEXT NULL
  and widens submitted_answer from VARCHAR(500) to TEXT (essay answers).

Adds to `exam_attempts`:
  - earned_points   DOUBLE PRECISION NULL
  - total_points    DOUBLE PRECISION NULL
  - pending_review  BOOLEAN NOT NULL DEFAULT FALSE

Existing data keeps its meaning: old questions are worth 1 point, old
attempts keep their stored score_percent. Only touches the database named
in this backend's own DATABASE_URL (backend/.env). Safe to re-run.

Usage (from backend/):
    python -m app.db.migrate_v19_points_and_essays
"""
from sqlalchemy import inspect, text

from app.db.database import engine

ADD_COLUMNS = {
    "questions": {
        "points": "INTEGER NOT NULL DEFAULT 1",
    },
    "question_attempts": {
        "points_awarded": "DOUBLE PRECISION",
        "needs_review": "BOOLEAN NOT NULL DEFAULT FALSE",
        "reviewed_at": "TIMESTAMPTZ",
        "reviewed_by_user_id": "UUID REFERENCES users(id) ON DELETE SET NULL",
        "teacher_comment": "TEXT",
    },
    "exam_attempts": {
        "earned_points": "DOUBLE PRECISION",
        "total_points": "DOUBLE PRECISION",
        "pending_review": "BOOLEAN NOT NULL DEFAULT FALSE",
    },
}


def _columns(table: str) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns(table)}


def migrate() -> None:
    print(f"Database: {engine.url.database}")
    for table, columns in ADD_COLUMNS.items():
        present = _columns(table)
        for name, ddl in columns.items():
            if name in present:
                print(f"{table}.{name} already present, skipping.")
                continue
            print(f"Adding {table}.{name} ...")
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))

    answer_type = str(_columns("question_attempts")["submitted_answer"]["type"]).upper()
    if "TEXT" not in answer_type:
        print("Widening question_attempts.submitted_answer to TEXT ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE question_attempts ALTER COLUMN submitted_answer TYPE TEXT"))
    else:
        print("question_attempts.submitted_answer already TEXT, skipping.")

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_question_attempts_needs_review "
                "ON question_attempts(exam_attempt_id) WHERE needs_review"
            )
        )
    print("Migration v19 complete.")


if __name__ == "__main__":
    migrate()
