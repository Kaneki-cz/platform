import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class AttendanceRecord(Base):
    """One student marked present in one teacher group on one calendar day —
    created by a teacher/admin scanning the student's QR code (see POST
    /api/v1/attendance/scan in app/api/routes/attendance.py). This is real
    in-person attendance for a physical tutoring session, entirely separate
    from LessonProgress (which tracks watching a recorded video online).

    Scoped to a TeacherGroup, not a Course/chapter — "which class session"
    maps naturally onto the group a student already picked during
    enrollment (see StudentGroupMembership), while a chapter is a content
    topic that has no notion of "today's session." The teacher picks a
    group in the mobile scanner screen before scanning, exactly once per
    session, and every scan against that group lands on today's date.

    session_date is a plain calendar Date (not just scanned_at's own
    timestamp) so the UNIQUE constraint below can cleanly mean "this
    student was already marked present in this group today" regardless of
    what time either scan happened — re-scanning the same student in the
    same session is a harmless no-op (see get_or_create_attendance), never
    a duplicate row or an error.

    Requires migrate_v16_attendance.py on an existing database.
    """

    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("student_user_id", "group_id", "session_date", name="uq_attendance_student_group_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teacher_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Which teacher/admin account did the scanning — purely informational
    # (an audit trail of who ran a given session), never used for access
    # control on its own.
    scanned_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    student: Mapped["User"] = relationship(foreign_keys=[student_user_id])
    group: Mapped["TeacherGroup"] = relationship()
