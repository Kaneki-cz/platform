"""One-time migration for exam rules (time limit, attempt limits, shuffling,
answer reveal) and in-progress drafts.

Adds to `exams`:
  - time_limit_minutes       INTEGER NULL  (NULL = no time limit)
  - max_attempts             INTEGER NULL  (NULL = unlimited)
  - retake_cooldown_minutes  INTEGER NULL  (NULL = no wait)
  - shuffle_questions        BOOLEAN NOT NULL DEFAULT TRUE
  - shuffle_choices          BOOLEAN NOT NULL DEFAULT TRUE
  - show_answers_on_fail     BOOLEAN NOT NULL DEFAULT FALSE

Adds to `exam_attempts`:
  - question_order     JSONB NULL
  - choice_orders      JSONB NULL
  - draft_answers      JSONB NULL
  - flagged_questions  JSONB NULL
  - auto_submitted     BOOLEAN NOT NULL DEFAULT FALSE

Only touches the `exams` and `exam_attempts` tables of the database named
in this backend's own DATABASE_URL (backend/.env) — nothing else. Safe to
run on an existing or brand-new database, and safe to re-run (each column
is only added if missing). Requires migrate_v9_exams.py to have run first.

Usage (from backend/):
    python -m app.db.migrate_v17_exam_rules
"""
from sqlalchemy import inspect, text

from app.db.database import engine

EXAM_COLUMNS = {
    "time_limit_minutes": "INTEGER",
    "max_attempts": "INTEGER",
    "retake_cooldown_minutes": "INTEGER",
    "shuffle_questions": "BOOLEAN NOT NULL DEFAULT TRUE",
    "shuffle_choices": "BOOLEAN NOT NULL DEFAULT TRUE",
    "show_answers_on_fail": "BOOLEAN NOT NULL DEFAULT FALSE",
}

ATTEMPT_COLUMNS = {
    "question_order": "JSONB",
    "choice_orders": "JSONB",
    "draft_answers": "JSONB",
    "flagged_questions": "JSONB",
    "auto_submitted": "BOOLEAN NOT NULL DEFAULT FALSE",
}


def _existing_columns(table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def _add_missing(table: str, columns: dict[str, str]) -> None:
    present = _existing_columns(table)
    for name, ddl in columns.items():
        if name in present:
            print(f"{table}.{name} already present, skipping.")
            continue
        print(f"Adding {table}.{name} ...")
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    if not {"exams", "exam_attempts"} <= tables:
        raise SystemExit("exams / exam_attempts tables not found — run migrate_v9_exams.py first.")
    print(f"Database: {engine.url.database}")
    _add_missing("exams", EXAM_COLUMNS)
    _add_missing("exam_attempts", ATTEMPT_COLUMNS)
    print("Migration v17 complete.")


if __name__ == "__main__":
    migrate()
