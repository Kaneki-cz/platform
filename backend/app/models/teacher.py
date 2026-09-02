import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class TeacherProfile(Base):
    """A DISPLAY CARD for a teacher within a subject — a name + photo the
    admin manages, shown to students so they can pick "which physics
    teacher" before browsing chapters/grades.

    Deliberately NOT a real user account and NOT the same thing as
    SubjectInstructor (app/models/subject.py), which grants a real logged-in
    user permission to edit a subject's content. A TeacherProfile has no
    login of its own — the admin creates it and uploads all of its videos on
    its behalf (confirmed with the user: teachers are "بطاقة عرض بس"، i.e.
    display-card-only, not real accounts).
    """

    __tablename__ = "teacher_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Same b2:<key> / http(s):// / /media/... convention as Lesson.video_url
    # (see app/services/b2_storage.py) — resolved on the mobile side by the
    # shared resolveVideoUrl/resolveFileUrl helper in lib/api.ts.
    photo_url: Mapped[str] = mapped_column(String(500), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subject: Mapped["Subject"] = relationship(back_populates="teachers")
