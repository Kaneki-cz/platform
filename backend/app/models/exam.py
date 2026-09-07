import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Exam(Base):
    """A standalone exam attached to a course/chapter — separate from the
    in-video segment quizzes (app/models/question.py's pause_at_seconds
    questions), which keep working exactly as before. An exam's questions
    are just Question rows with exam_id set instead of lesson_id (see that
    model's docstring).

    An exam sits at a specific point in the course's lesson sequence via
    `order_index`, sharing the SAME numbering space as Lesson.order_index:
    any lesson in this course whose order_index is greater than this exam's
    is locked for students until they pass it (best-attempt score >=
    passing_percent) — see app/services/exam_gate.py for the actual
    enforcement, applied in both app/api/routes/courses.py (the
    chapter/lecture LIST) and app/api/routes/lessons.py (a single lecture
    fetch, which withholds video_url the same way it already does for
    max_views/access codes). A lesson can opt out of being gated by ANY
    exam via Lesson.exempt_from_exam_gate, regardless of how many exams
    precede it.

    Requires migrate_v9_exams.py on an existing database.
    """

    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Shares Lesson.order_index's numbering space within the same course —
    # see the class docstring for how this drives gating.
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    # 0-100. A student's best attempt must score >= this to count as passed.
    # Defaults to 75 to match the platform's existing segment-quiz pass bar
    # (app/api/routes/courses.py's PASS_THRESHOLD) — editable per exam since
    # not every exam should carry the same bar.
    passing_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=75, server_default="75")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="exams")
    questions: Mapped[list["Question"]] = relationship(back_populates="exam", cascade="all, delete-orphan")
    attempts: Mapped[list["ExamAttempt"]] = relationship(back_populates="exam", cascade="all, delete-orphan")


class ExamAttempt(Base):
    """One sitting of one exam by one student. Groups that sitting's
    QuestionAttempt rows together (via QuestionAttempt.exam_attempt_id) so a
    score and a completion time can be computed for the attempt as a whole.

    `started_at` is set the moment the student opens the exam
    (POST /api/v1/exams/{id}/start) and is the server-anchored clock the
    mobile app's countdown/elapsed timer is built from — the client never
    supplies or trusts its own clock for this, so force-closing the app
    mid-exam can't be used to "pause" the timer. `submitted_at`,
    `score_percent`, `passed` and `duration_seconds` are all filled in
    together on submit (POST /api/v1/exams/attempts/{id}/submit).

    An attempt with submitted_at still NULL is "in progress" — starting the
    same exam again resumes it rather than creating a second one in
    parallel (see the /start route), so a dropped connection can't be used
    to reset the clock either.

    duration_seconds is stored (not only derivable from the two timestamps)
    so a later "flag suspiciously fast completions" feature can query it
    directly without recomputing it per row or worrying about clock skew
    between the two requests that set started_at/submitted_at.
    """

    __tablename__ = "exam_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exams.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    score_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    passed: Mapped[bool] = mapped_column(default=False, server_default="false")
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    exam: Mapped["Exam"] = relationship(back_populates="attempts")
    user: Mapped["User"] = relationship()
    answers: Mapped[list["QuestionAttempt"]] = relationship(back_populates="exam_attempt")
