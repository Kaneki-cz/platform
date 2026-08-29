import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.user import User
from app.schemas.course import CourseCreate, CourseDetailOut, CourseOut, CourseUpdate

router = APIRouter(prefix="/api/v1/courses", tags=["courses"])


@router.get("", response_model=list[CourseOut])
def list_courses(db: Session = Depends(get_db), _=Depends(get_current_user)) -> list[Course]:
    return db.query(Course).order_by(Course.order_index).all()


@router.get("/{course_id}", response_model=CourseDetailOut)
def get_course(course_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_user)) -> Course:
    course = (
        db.query(Course)
        .options(selectinload(Course.lessons))
        .filter(Course.id == course_id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.post("", response_model=CourseOut, status_code=201)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Course:
    ensure_can_manage_subject(db, current_user, payload.subject_id)
    course = Course(
        subject_id=payload.subject_id,
        title=payload.title,
        description=payload.description,
        grade_level=payload.grade_level,
        order_index=payload.order_index,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.put("/{course_id}", response_model=CourseOut)
def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_subject(db, current_user, course.subject_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=204)
def delete_course(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_subject(db, current_user, course.subject_id)
    db.delete(course)
    db.commit()
