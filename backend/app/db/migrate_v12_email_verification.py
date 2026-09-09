"""One-time migration: adds the email-verification-at-signup columns to
users (see app/models/user.py's is_verified/verification_* fields and
app/api/routes/auth.py's /register, /verify-email, /resend-verification).

Safe to run on either an existing or a brand-new database — only adds what's
missing, and is safe to re-run. Independent of every other migration
(different columns) — run in any order.

is_verified is added with DEFAULT TRUE specifically so every account that
already existed before this feature shipped is grandfathered in as verified
(they never went through a code step, so DEFAULT FALSE here would lock every
existing student out at their next login) — new accounts still get
is_verified=False, since app/models/user.py's Python-side `default=False`
is what the ORM actually sends on INSERT, not this column default.

Usage:
    python -m app.db.migrate_v12_email_verification
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

    if not _column_exists("users", "is_verified"):
        print("Adding users.is_verified (existing accounts grandfathered in as verified) ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT TRUE"))
    else:
        print("users.is_verified already present, skipping.")

    if not _column_exists("users", "verification_code"):
        print("Adding users.verification_code ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN verification_code VARCHAR(6)"))
    else:
        print("users.verification_code already present, skipping.")

    if not _column_exists("users", "verification_code_expires_at"):
        print("Adding users.verification_code_expires_at ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN verification_code_expires_at TIMESTAMPTZ"))
    else:
        print("users.verification_code_expires_at already present, skipping.")

    if not _column_exists("users", "verification_code_sent_at"):
        print("Adding users.verification_code_sent_at ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN verification_code_sent_at TIMESTAMPTZ"))
    else:
        print("users.verification_code_sent_at already present, skipping.")

    if not _column_exists("users", "verification_attempts"):
        print("Adding users.verification_attempts ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0"))
    else:
        print("users.verification_attempts already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
