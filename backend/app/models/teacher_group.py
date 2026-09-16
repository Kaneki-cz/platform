import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class TeacherGroup(Base):
    """A named group that a teacher creates for their students.

    The teacher sets group names from the admin UI; students pick their
    group on their first lesson visit for this teacher. Multiple students
    can be in the same group (many-to-one relationship through
    StudentGroupMembership.group_id).
    """

    __tablename__ = "teacher_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("teacher_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # A group deletion nulls out the group_id on existing memberships (via
    # ON DELETE SET NULL on the FK in StudentGroupMembership — see that
    # model's group_id definition). The cascade here only removes in-memory
    # Python objects loaded in the same session; the DB-level nullification
    # is what actually preserves the membership row.
    memberships: Mapped[list["StudentGroupMembership"]] = relationship(
        back_populates="group",
    )
