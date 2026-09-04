import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class LessonProgress(Base):
    __tablename__ = "lesson_progress"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    lesson_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lessons.id"), nullable=False)
    completion_percent: Mapped[float] = mapped_column(Float, default=0.0)
    # How many times this student has opened this lecture's video — only
    # tracked/enforced for lessons the teacher/admin capped via
    # Lesson.max_views (see that column's comment). Incremented in
    # app/api/routes/lessons.py's get_lesson, once per successful open;
    # never touched for uncapped lessons. Requires migrate_v7_view_limits.py
    # on an existing database.
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Extra views an admin has granted THIS student for THIS lesson, on top
    # of Lesson.max_views — e.g. to undo an accidental reload that burned a
    # view. Permanent (unlike ai_bonus_questions on User, which resets daily)
    # since there's no daily cycle to a view count. See
    # app/api/routes/admin.py's POST /users/{id}/lessons/{id}/bonus-views.
    bonus_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="progress")
    lesson: Mapped["Lesson"] = relationship(back_populates="progress_entries")
