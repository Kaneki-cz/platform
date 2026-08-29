import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Subject(Base):
    """Top-level domain, e.g. Physics / Chemistry / Biology.

    A subject contains courses ("chapters" in the app's UI, e.g. "الفصل
    الأول: التيار الكهربي..."), which contain lessons ("lectures").
    """

    __tablename__ = "subjects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    courses: Mapped[list["Course"]] = relationship(
        back_populates="subject", order_by="Course.order_index", cascade="all, delete-orphan"
    )
    instructors: Mapped[list["SubjectInstructor"]] = relationship(back_populates="subject", cascade="all, delete-orphan")


class SubjectInstructor(Base):
    """Assigns a user (role=instructor or admin) as a content owner of a subject.

    An instructor can create/edit courses+lessons only within subjects they
    appear here for; admins bypass this check entirely (see app/api/deps.py).
    """

    __tablename__ = "subject_instructors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subject: Mapped["Subject"] = relationship(back_populates="instructors")
    user: Mapped["User"] = relationship(back_populates="taught_subjects")
