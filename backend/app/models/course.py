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
    # A free-text column at the DB layer on purpose (see migrate_v5's own
    # comment style) — constrained to a fixed set of 4 Arabic strings at the
    # Pydantic layer instead (app/schemas/course.py's GradeLevel), so adding
    # a 5th grade later never needs an ALTER TYPE migration.
    grade_level: Mapped[str] = mapped_column(String(50), nullable=True)  # e.g. "الصف الأول الثانوي"
    # Which display-card teacher (app/models/teacher.py) this chapter is
    # filed under, for the student-facing teacher -> grade -> chapters
    # browsing flow. Nullable: existing courses created before this feature
    # keep working with no teacher assigned.
    teacher_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teacher_profiles.id"), nullable=True)
    # Same b2:<key> / http(s):// / /media/... convention as Lesson.video_url.
    cover_image_url: Mapped[str] = mapped_column(String(500), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subject: Mapped["Subject"] = relationship(back_populates="courses")
    teacher: Mapped["TeacherProfile"] = relationship()
    lessons: Mapped[list["Lesson"]] = relationship(back_populates="course", order_by="Lesson.order_index", cascade="all, delete-orphan")
