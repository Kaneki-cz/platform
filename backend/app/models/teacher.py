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

    Originally (see git history) this was deliberately NOT a real user
    account — the admin created it and uploaded all of its videos on its
    behalf. That changed 2026-09: a TeacherProfile can now optionally be
    LINKED to a real instructor account via `user_id` (see
    app/api/routes/teachers.py's link_teacher_account/unlink_teacher_account,
    used from the mobile admin/subject/[id].tsx screen). Once linked, that
    user can create/edit lessons+exams in every Course whose teacher_id
    points at this profile (see app/api/deps.py's ensure_can_manage_course)
    — this is now how an instructor's edit access is scoped, replacing the
    old subject-wide SubjectInstructor grant (app/models/subject.py, kept in
    the DB for backward compatibility but no longer consulted by any
    permission check). A teacher profile with user_id still NULL behaves
    exactly as before: a pure display card nobody can log in as.
    Requires migrate_v13_teacher_accounts.py on an existing database.
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
    # The real instructor account linked to this display card, if any — see
    # the class docstring above. NULL = unclaimed (a pure display card, the
    # only state that existed before this feature). unique=True: one account
    # can be linked to at most one teacher profile at a time (enforced again
    # at the application layer in link_teacher_account with a friendlier
    # error message before this constraint would ever fire).
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subject: Mapped["Subject"] = relationship(back_populates="teachers")
    user: Mapped["User | None"] = relationship()
