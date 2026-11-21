"""One-time migration for the home-screen day streak.

Creates `user_activity_days` (user_id, day) — one row per student per
Cairo-local day they studied — and seeds it from history that already
exists, so streaks don't all start at zero on release:
  - question_attempts.created_at   (quiz + exam answers)
  - exam_attempts.started_at
  - lesson_progress.last_viewed_at (latest view per lesson only)

Only touches the database named in this backend's own DATABASE_URL
(backend/.env). Safe to re-run: the table is only created if missing and
seeding skips days already recorded.

Usage (from backend/):
    python -m app.db.migrate_v18_activity_streak
"""
from sqlalchemy import inspect, text

from app.db.database import engine

SEED_SOURCES = [
    ("question_attempts", "created_at"),
    ("exam_attempts", "started_at"),
    ("lesson_progress", "last_viewed_at"),
]


def migrate() -> None:
    print(f"Database: {engine.url.database}")
    tables = set(inspect(engine).get_table_names())
    if "user_activity_days" not in tables:
        print("Creating user_activity_days ...")
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE user_activity_days (
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        day     DATE NOT NULL,
                        PRIMARY KEY (user_id, day)
                    )
                    """
                )
            )
    else:
        print("user_activity_days already present, skipping create.")

    for table, column in SEED_SOURCES:
        if table not in tables:
            continue
        with engine.begin() as conn:
            result = conn.execute(
                text(
                    f"""
                    INSERT INTO user_activity_days (user_id, day)
                    SELECT DISTINCT user_id, ({column} AT TIME ZONE 'Africa/Cairo')::date
                    FROM {table}
                    WHERE {column} IS NOT NULL
                    ON CONFLICT DO NOTHING
                    """
                )
            )
            print(f"Seeded {result.rowcount} day(s) from {table}.{column}.")
    print("Migration v18 complete.")


if __name__ == "__main__":
    migrate()
