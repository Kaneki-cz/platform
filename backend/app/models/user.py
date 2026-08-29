import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Enum, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class PlanTier(str, enum.Enum):
    free = "free"
    pro = "pro"


class UserRole(str, enum.Enum):
    student = "student"
    # Can create/edit courses+lessons within the subjects they're assigned to
    # (see SubjectInstructor in app/models/subject.py).
    instructor = "instructor"
    # Can do everything an instructor can, in every subject, plus create
    # subjects and assign instructors to them.
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=True)
    plan: Mapped[PlanTier] = mapped_column(Enum(PlanTier), default=PlanTier.free, nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.student, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # An admin's per-account override of the AI daily-question limit — NULL
    # (the default for everyone) means "use the plan-based default"; a set
    # value replaces it entirely, however high or low, for this one account.
    # Ignored for role=admin accounts, which are always unlimited (see
    # effective_ai_daily_limit) — this only matters for student/instructor
    # accounts. See app/api/routes/admin.py's PUT /users/{id}/ai-limit.
    # Requires migrate_v3_ai_limit.py on an existing database.
    ai_daily_limit_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A one-time top-up of extra questions for TODAY only (e.g. an admin
    # bumping a student who burned through their normal limit) — deliberately
    # separate from ai_daily_limit_override so it doesn't silently become a
    # new permanent limit. ai_bonus_questions_date records which day it was
    # granted for; once that date isn't today anymore, ai_bonus_questions_today
    # (below) reports 0 with no reset job needed — same pattern as
    # ai_chat.py's _used_today, which is also computed live rather than
    # stored/reset. See app/api/routes/admin.py's POST /users/{id}/ai-bonus.
    # Requires migrate_v4_ai_bonus.py on an existing database.
    ai_bonus_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    ai_bonus_questions_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    progress: Mapped[list["LessonProgress"]] = relationship(back_populates="user")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user")
    question_attempts: Mapped[list["QuestionAttempt"]] = relationship(back_populates="user")
    taught_subjects: Mapped[list["SubjectInstructor"]] = relationship(back_populates="user")

    @property
    def effective_ai_daily_limit(self) -> int | None:
        """The AI daily-question limit actually enforced for this user,
        *before* any today-only bonus (see ai_bonus_questions_today) is
        added on top — None means unlimited, which is always true for
        role=admin accounts (they're simply never rate-limited), otherwise
        `ai_daily_limit_override` when an admin has set one, otherwise the
        plan-based default from core/config.py. Single source of truth so
        api/routes/ai_chat.py (enforcement) and api/routes/admin.py (what
        the admin sees/edits) can never drift apart."""
        if self.role == UserRole.admin:
            return None
        if self.ai_daily_limit_override is not None:
            return self.ai_daily_limit_override
        from app.core.config import settings  # local import: avoids a module-load-time cycle with core.config

        return settings.AI_DAILY_REQUEST_LIMIT_PRO if self.plan == PlanTier.pro else settings.AI_DAILY_REQUEST_LIMIT_FREE

    @property
    def ai_bonus_questions_today(self) -> int:
        """Extra questions granted for today specifically — 0 once the date
        has rolled past `ai_bonus_questions_date` (see the field's comment
        above for why this isn't a permanent addition)."""
        if self.ai_bonus_questions_date == datetime.now(timezone.utc).date():
            return self.ai_bonus_questions
        return 0
