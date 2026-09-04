import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.progress import LessonProgress
from app.models.user import User, UserRole
from app.schemas.auth import AiBonusGrant, AiLimitUpdate, RoleUpdate, UserOut
from app.schemas.progress import BonusViewsGrant, LessonViewOut

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> list[User]:
    return db.query(User).order_by(User.created_at).all()


@router.put("/users/{user_id}/role", response_model=UserOut)
def set_user_role(
    user_id: uuid.UUID,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    if payload.role not in {r.value for r in UserRole}:
        raise HTTPException(status_code=400, detail='role must be "student", "instructor", or "admin"')

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id and payload.role != UserRole.admin.value:
        raise HTTPException(status_code=400, detail="You can't demote yourself")

    user.role = UserRole(payload.role)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/ai-limit", response_model=UserOut)
def set_user_ai_limit(
    user_id: uuid.UUID,
    payload: AiLimitUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> User:
    """Overrides how many AI-assistant questions this one account gets per
    day, replacing the free/pro plan default entirely (see
    app/models/user.py's effective_ai_daily_limit). `daily_limit: null`
    clears the override. Works on the calling admin's own account too — an
    admin who wants a bigger (or unlimited-feeling) quota for themselves
    just calls this with their own user_id, same as for anyone else.
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.ai_daily_limit_override = payload.daily_limit
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/ai-bonus", response_model=UserOut)
def grant_ai_bonus_questions(
    user_id: uuid.UUID,
    payload: AiBonusGrant,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> User:
    """Grants `extra` more AI questions for TODAY only — e.g. a student ran
    out and asked for a few more. Stacks with any bonus already granted
    today (two +5 grants the same day add up to +10); a leftover bonus from
    a previous day is replaced rather than added to, since it no longer
    applies anyway (see User.ai_bonus_questions_today).
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    today = datetime.now(timezone.utc).date()
    current_bonus = user.ai_bonus_questions if user.ai_bonus_questions_date == today else 0
    user.ai_bonus_questions = current_bonus + payload.extra
    user.ai_bonus_questions_date = today
    db.commit()
    db.refresh(user)
    return user


# --- Per-lecture view limits ------------------------------------------------
# See app/models/lesson.py's max_views and app/models/progress.py's
# view_count/bonus_views for the underlying feature: an instructor/admin can
# cap how many times a student may open a specific lecture's video, and use
# the two endpoints below to fix a student up who got blocked by mistake
# (e.g. an accidental reload burned a view) — either by resetting their
# count back to 0, or by granting extra views on top of the lesson's normal
# cap. Both only ever touch ONE student's standing on ONE lesson, never the
# lesson's own max_views setting (that's edited from the lecture itself, see
# PUT /api/v1/lessons/{id}).


def _lesson_view_out(entry: LessonProgress, lesson: Lesson, course_title: str) -> LessonViewOut:
    allowed = (lesson.max_views or 0) + entry.bonus_views
    return LessonViewOut(
        lesson_id=lesson.id,
        lesson_title=lesson.title,
        course_title=course_title,
        max_views=lesson.max_views or 0,
        view_count=entry.view_count,
        bonus_views=entry.bonus_views,
        views_allowed=allowed,
        view_limit_reached=entry.view_count >= allowed,
    )


@router.get("/users/{user_id}/lesson-views", response_model=list[LessonViewOut])
def list_user_lesson_views(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[LessonViewOut]:
    """Every max_views-capped lecture this student has actually opened at
    least once, with their current view-count standing on each — the list
    the admin picks from before granting bonus views or resetting a count.
    Uncapped lectures never appear here (there's nothing to manage)."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rows = (
        db.query(LessonProgress, Lesson, Course)
        .join(Lesson, Lesson.id == LessonProgress.lesson_id)
        .join(Course, Course.id == Lesson.course_id)
        .filter(LessonProgress.user_id == user_id, Lesson.max_views.isnot(None))
        .order_by(Course.order_index, Lesson.order_index)
        .all()
    )
    return [_lesson_view_out(entry, lesson, course.title) for entry, lesson, course in rows]


@router.post("/users/{user_id}/lessons/{lesson_id}/bonus-views", response_model=LessonViewOut)
def grant_bonus_views(
    user_id: uuid.UUID,
    lesson_id: uuid.UUID,
    payload: BonusViewsGrant,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> LessonViewOut:
    """Adds `extra` more views for this one student on this one lesson, on
    top of the lesson's normal max_views — permanent, stacks with any bonus
    already granted (unlike the AI daily-question bonus, there's no daily
    reset here)."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if lesson.max_views is None:
        raise HTTPException(status_code=400, detail="This lecture has no view limit set — nothing to grant extra views against.")

    entry = (
        db.query(LessonProgress)
        .filter(LessonProgress.user_id == user_id, LessonProgress.lesson_id == lesson_id)
        .first()
    )
    if entry is None:
        entry = LessonProgress(user_id=user_id, lesson_id=lesson_id)
        db.add(entry)

    entry.bonus_views = (entry.bonus_views or 0) + payload.extra
    db.commit()
    db.refresh(entry)
    return _lesson_view_out(entry, lesson, lesson.course.title)


@router.post("/users/{user_id}/lessons/{lesson_id}/reset-views", response_model=LessonViewOut)
def reset_lesson_views(
    user_id: uuid.UUID,
    lesson_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> LessonViewOut:
    """Resets this student's used-view count on this lesson back to 0 —
    e.g. after an accidental reload burned a view. Leaves any bonus_views
    already granted untouched; leaves the lesson's own max_views untouched."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    entry = (
        db.query(LessonProgress)
        .filter(LessonProgress.user_id == user_id, LessonProgress.lesson_id == lesson_id)
        .first()
    )
    if entry is None:
        entry = LessonProgress(user_id=user_id, lesson_id=lesson_id)
        db.add(entry)

    entry.view_count = 0
    db.commit()
    db.refresh(entry)
    return _lesson_view_out(entry, lesson, lesson.course.title)
