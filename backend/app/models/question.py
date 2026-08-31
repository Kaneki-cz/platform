import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lessons.id"), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(50), default="multiple_choice")  # or "numeric", "free_response"
    choices: Mapped[dict] = mapped_column(JSONB, nullable=True)  # for multiple_choice
    correct_answer: Mapped[str] = mapped_column(String(500), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=True)
    # Second into the lecture's video where playback should pause and this
    # question's segment-quiz should appear — every question sharing the
    # same value belongs to the same "part" of the lecture. NULL means "no
    # specific pause point" (shown once the video ends instead — see
    # app/api/routes/courses.py's segment-grouping for how this is used to
    # gate progression: a lesson's next sibling is locked until every one of
    # its segments is passed at >=75%). Requires
    # migrate_v5_question_segments.py on an existing database.
    pause_at_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    lesson: Mapped["Lesson"] = relationship(back_populates="questions")
    attempts: Mapped[list["QuestionAttempt"]] = relationship(back_populates="question", cascade="all, delete-orphan")


class QuestionAttempt(Base):
    __tablename__ = "question_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    question_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("questions.id"), nullable=False)
    submitted_answer: Mapped[str] = mapped_column(String(500), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="question_attempts")
    question: Mapped["Question"] = relationship(back_populates="attempts")
