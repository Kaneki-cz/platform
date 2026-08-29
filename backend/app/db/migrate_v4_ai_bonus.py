"""One-time migration: adds users.ai_bonus_questions and
users.ai_bonus_questions_date to an existing database — lets an admin grant
a student extra AI questions for just today (e.g. after they've burned
through their normal daily limit), without touching their permanent daily
limit (see app/models/user.py's ai_bonus_questions_today property and
app/api/routes/admin.py's POST /users/{id}/ai-bonus).

Safe to run on either an existing or a brand-new database — only adds
what's missing, and is safe to re-run. Independent of migrate_v3_ai_limit.py
(different columns) — run them in either order.

Usage:
    python -m app.db.migrate_v4_ai_bonus
"""
from sqlalchemy import inspect, text

from app.db.database import engine


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def migrate() -> None:
    inspector = inspect(engine)
    if "users" not in set(inspector.get_table_names()):
        print("users table doesn't exist yet — run `python -m app.db.init_db` first.")
        return

    if not _column_exists("users", "ai_bonus_questions"):
        print("Adding users.ai_bonus_questions ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_bonus_questions INTEGER NOT NULL DEFAULT 0"))
    else:
        print("users.ai_bonus_questions already present, skipping.")

    if not _column_exists("users", "ai_bonus_questions_date"):
        print("Adding users.ai_bonus_questions_date ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_bonus_questions_date DATE"))
    else:
        print("users.ai_bonus_questions_date already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
