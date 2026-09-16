import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class StudentGroupMembership(Base):
    """One row per (student, teacher) pair — created the first time a student
    fills out the enrollment form for a specific teacher.

    full_name_ar and grade are stored globally on the User model (one name
    and one grade for the whole app — the student doesn't have a different
    name for each teacher). Only the group assignment is per-teacher here.

    group_id is nullable: if the teacher has no groups yet when the student
    first enrolls, the membership is created with group_id = NULL. The mobile
    app re-shows the group picker (EnrollmentModal with needs_group=True)
    the next time the student opens a lesson for this teacher once groups have
    been added, letting them pick a group then.
    """

    __tablename__ = "student_group_memberships"
    __table_args__ = (
        UniqueConstraint("student_user_id", "teacher_id", name="uq_student_teacher"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("teacher_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # NULL = no group assigned yet (teacher had no groups when student enrolled,
    # or admin deliberately cleared it). See class docstring above.
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("teacher_groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["TeacherGroup | None"] = relationship(back_populates="memberships")
