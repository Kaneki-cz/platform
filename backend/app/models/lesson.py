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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="lessons")
    questions: Mapped[list["Question"]] = relationship(back_populates="lesson", cascade="all, delete-orphan")
    progress_entries: Mapped[list["LessonProgress"]] = relationship(
        back_populates="lesson", cascade="all, delete-orphan"
    )
