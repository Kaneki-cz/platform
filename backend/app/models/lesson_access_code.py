import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class LessonAccessCode(Base):
    """A single-use redemption code that unlocks ONE lecture's video for
    whichever student redeems it — separate from (and independent of)
    Lesson.max_views: max_views caps how many times an already-allowed
    student can rewatch, while this feature controls who is allowed to open
    the video in the first place. A lecture with no rows here behaves
    exactly as before (open to any student, subject to max_views as usual);
    generating even one code for a lecture switches it into "requires a
    code" mode going forward — see app/api/routes/lessons.py's get_lesson
    and app/api/routes/courses.py's _annotate_code_gate for the enforcement.

    `code` is UNIQUE ACROSS THE WHOLE TABLE (not just within one lesson) on
    purpose, per the actual requirement: a code that unlocks one lecture
    must never also work on a different one, so a batch generated for
    Lecture A can never accidentally double as a valid code for Lecture B.

    Requires migrate_v8_lesson_access_codes.py on an existing database.
    """

    __tablename__ = "lesson_access_codes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lessons.id"), nullable=False, index=True)
    # Human-typeable, e.g. "7F3K-9QRT" — generated from a charset that drops
    # visually-ambiguous characters (0/O, 1/I/L) since students type these by
    # hand. See app/api/routes/lesson_access_codes.py's _generate_code.
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    # NULL = still unused. Set (with redeemed_at) the moment a student
    # successfully redeems it — a code is single-use for its whole lifetime,
    # never freed up again even if the redeeming student loses access some
    # other way (matches "must be used once at the platform level" from the
    # feature request this was built for).
    redeemed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lesson: Mapped["Lesson"] = relationship(back_populates="access_codes")
    redeemed_by: Mapped["User"] = relationship()
