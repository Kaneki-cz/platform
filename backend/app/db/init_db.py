"""Create all tables from the SQLAlchemy models.

Fine for local development. For anything resembling production, replace
this with real Alembic migrations (`alembic init`, `alembic revision
--autogenerate`, `alembic upgrade head`) so schema changes are versioned.

Usage:
    python -m app.db.init_db
"""
from app.db.database import Base, engine
from app.models import *  # noqa: F401,F403  (import so metadata is registered)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    print("Tables created.")


if __name__ == "__main__":
    init_db()
