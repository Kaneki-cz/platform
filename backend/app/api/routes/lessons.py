import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.user import User
from app.schemas.course import LessonCreate, LessonDetailOut, LessonUpdate

router = APIRouter(prefix="/api/v1/lessons", tags=["lessons"])


@router.get("/{lesson_id}", response_model=LessonDetailOut)
def get_lesson(lesson_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_user)) -> Lesson:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson


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
