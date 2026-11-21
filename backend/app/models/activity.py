import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class UserActivityDay(Base):
    """One row per student per day they did anything that counts as
    studying (watched a lecture, answered a quiz question, took an exam) —
    the source for the home screen's day streak. Dates are Cairo-local (see
    app/services/activity.py). Requires migrate_v18_activity_streak.py."""

    __tablename__ = "user_activity_days"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
