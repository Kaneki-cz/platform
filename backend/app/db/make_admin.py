"""One-time bootstrap: promote a registered user to admin by email.

There's no public API endpoint that can create the first admin (that would
be a privilege-escalation hole), so this script is the intended way to
create one. After that, the admin can promote/assign others from within
the app itself.

Usage:
    python -m app.db.make_admin someone@example.com
"""
import sys

from app.db.database import SessionLocal
from app.models.user import User, UserRole


def make_admin(email: str) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"No user found with email {email!r} — they need to register in the app first.")
            return
        user.role = UserRole.admin
        db.commit()
        print(f"{email} is now an admin.")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m app.db.make_admin <email>")
        sys.exit(1)
    make_admin(sys.argv[1])
