import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.progress import LessonProgress
from app.models.user import User, UserRole
from app.schemas.course import LessonCreate, LessonDetailOut, LessonUpdate

router = APIRouter(prefix="/api/v1/lessons", tags=["lessons"])


@router.get("/{lesson_id}", response_model=LessonDetailOut)
def get_lesson(
    lesson_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LessonDetailOut:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    video_url = lesson.video_url
    views_used: int | None = None
    views_allowed: int | None = None
    view_limit_reached = False

    # The view-count cap only ever applies to students, and only to lessons
    # an instructor/admin explicitly opted into limiting (max_views is NULL
    # by default = unlimited — see app/models/lesson.py). This same endpoint
    # is also what the admin "manage questions" screen calls to show a
    # lecture's title while editing, so instructor/admin callers must never
    # be capped or counted here.
    if current_user.role == UserRole.student and lesson.max_views is not None and lesson.video_url:
        entry = (
            db.query(LessonProgress)
            .filter(LessonProgress.user_id == current_user.id, LessonProgress.lesson_id == lesson.id)
            .first()
        )
        if entry is None:
            entry = LessonProgress(user_id=current_user.id, lesson_id=lesson.id)
            db.add(entry)
            db.flush()  # so entry.view_count/bonus_views (both default 0) are usable below

        views_allowed = lesson.max_views + entry.bonus_views
        view_limit_reached = entry.view_count >= views_allowed
        if view_limit_reached:
            # Already used up every allowed view (base + any admin-granted
            # bonus) — hand back no video_url at all so the app can't play
            # it, instead of merely hoping the UI hides the player.
            video_url = None
        else:
            entry.view_count += 1
            db.commit()
            db.refresh(entry)
        views_used = entry.view_count

    return LessonDetailOut(
        id=lesson.id,
        title=lesson.title,
        content=lesson.content,
        video_url=video_url,
        order_index=lesson.order_index,
        max_views=lesson.max_views,
        views_used=views_used,
        views_allowed=views_allowed,
        view_limit_reached=view_limit_reached,
    )


def _subject_id_of_course(db: Session, course_id: uuid.UUID) -> uuid.UUID:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course.subject_id


@router.post("", response_model=LessonDetailOut, status_code=201)
def create_lesson(
    payload: LessonCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Lesson:
    subject_id = _subject_id_of_course(db, payload.course_id)
    ensure_can_manage_subject(db, current_user, subject_id)

    lesson = Lesson(
        course_id=payload.course_id,
        title=payload.title,
        content=payload.content,
        video_url=payload.video_url,
        order_index=payload.order_index,
        max_views=payload.max_views,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


@router.put("/{lesson_id}", response_model=LessonDetailOut)
def update_lesson(
    lesson_id: uuid.UUID,
    payload: LessonUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Lesson:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_course(db, lesson.course_id))

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(lesson, field, value)
    db.commit()
    db.refresh(lesson)
    return lesson


@router.delete("/{lesson_id}", status_code=204)
def delete_lesson(
    lesson_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_course(db, lesson.course_id))
    db.delete(lesson)
    db.commit()
