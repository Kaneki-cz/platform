import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Course(Base):
    """A chapter within a subject, e.g. "الفصل الأول: التيار الكهربي..."."""

    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    grade_level: Mapped[str] = mapped_column(String(50), nullable=True)  # e.g. "Grade 10"
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subject: Mapped["Subject"] = relationship(back_populates="courses")
    lessons: Mapped[list["Lesson"]] = relationship(back_populates="course", order_by="Lesson.order_index", cascade="all, delete-orphan")
