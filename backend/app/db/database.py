"""SQLAlchemy engine/session setup + FastAPI DB dependency."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# pool_size/max_overflow explicit on purpose (SQLAlchemy's defaults are
# pool_size=5, max_overflow=10 = 15 connections total, sized for a single
# app process). Once physics-backend.service runs multiple Uvicorn workers
# (see --workers on its ExecStart line), EACH worker gets its own engine
# and therefore its own separate pool of this size — so the real ceiling is
# (pool_size + max_overflow) * worker_count. With 3 workers this is
# 20 * 3 = 60 total connections, comfortably under Postgres's default
# max_connections (100) while giving a big real ceiling above the old 15.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
