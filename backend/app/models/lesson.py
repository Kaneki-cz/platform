import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Lesson(Base):
    __tablename__ = "lessons"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=True)  # markdown/rich text body
    video_url: Mapped[str] = mapped_column(String(500), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    # Caps how many times ONE student account may open this lecture's video —
    # NULL (the default, for every lesson created before this feature and any
    # new one where the teacher/admin doesn't set a number) means unlimited,
    # so nothing changes for existing content unless someone opts in. Set by
    # an instructor/admin per-lecture (not a single platform-wide number),
    # since how many rewatches make sense varies lecture to lecture. Enforced
    # in app/api/routes/lessons.py's get_lesson, which tracks each student's
    # count on their own LessonProgress row (see app/models/progress.py's
    # view_count/bonus_views). Requires migrate_v7_view_limits.py on an
    # existing database.
    max_views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="lessons")
    questions: Mapped[list["Question"]] = relationship(back_populates="lesson", cascade="all, delete-orphan")
    progress_entries: Mapped[list["LessonProgress"]] = relationship(
        back_populates="lesson", cascade="all, delete-orphan"
    )
