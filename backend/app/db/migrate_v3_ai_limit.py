"""One-time migration: adds users.ai_daily_limit_override to an existing
database — lets an admin override the AI daily-question limit on a
per-account basis instead of everyone being stuck on the free/pro plan
default (see app/models/user.py's effective_ai_daily_limit and
app/api/routes/admin.py's PUT /users/{id}/ai-limit).

Safe to run on either an existing (already has data) or a brand-new
database — it only adds the column if it's missing, and is safe to re-run.
If you've never run `init_db.py` before, you don't need this at all; a
fresh database already gets the final schema straight away.

Usage:
    python -m app.db.migrate_v3_ai_limit
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if "users" in existing_tables and not _column_exists("users", "ai_daily_limit_override"):
        print("Adding users.ai_daily_limit_override ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_daily_limit_override INTEGER"))
    else:
        print("users.ai_daily_limit_override already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
