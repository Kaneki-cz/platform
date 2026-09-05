"""Display-card teachers shown when a student browses a subject (e.g.
Physics -> pick a teacher -> pick a grade -> chapters). See
app/models/teacher.py for why these are deliberately NOT real user
accounts, unlike SubjectInstructor.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.teacher import TeacherProfile
from app.models.user import User
from app.schemas.teacher import TeacherCreate, TeacherOut, TeacherUpdate
from app.services import b2_storage

router = APIRouter(prefix="/api/v1", tags=["teachers"])


@router.get("/subjects/{subject_id}/teachers", response_model=list[TeacherOut])
def list_teachers(
    subject_id: uuid.UUID,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
) -> list[TeacherProfile]:
    return (
        db.query(TeacherProfile)
        .filter(TeacherProfile.subject_id == subject_id)
        .order_by(TeacherProfile.order_index)
        .all()
    )


@router.post("/teachers", response_model=TeacherOut, status_code=201)
def create_teacher(
    payload: TeacherCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> TeacherProfile:
    ensure_can_manage_subject(db, current_user, payload.subject_id)
    teacher = TeacherProfile(
        subject_id=payload.subject_id,
        name=payload.name,
        photo_url=payload.photo_url,
        order_index=payload.order_index,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


@router.put("/teachers/{teacher_id}", response_model=TeacherOut)
def update_teacher(
    teacher_id: uuid.UUID,
    payload: TeacherUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> TeacherProfile:
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    ensure_can_manage_subject(db, current_user, teacher.subject_id)

    fields = payload.model_dump(exclude_unset=True)
    old_photo_url = teacher.photo_url if "photo_url" in fields else None

    for field, value in fields.items():
        setattr(teacher, field, value)
    db.commit()
    db.refresh(teacher)

    if old_photo_url is not None and old_photo_url != teacher.photo_url:
        b2_storage.delete_object_for_url(old_photo_url)

    return teacher


@router.delete("/teachers/{teacher_id}", status_code=204)
def delete_teacher(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    ensure_can_manage_subject(db, current_user, teacher.subject_id)

    in_use = db.query(Course).filter(Course.teacher_id == teacher_id).first()
    if in_use:
        raise HTTPException(
            status_code=400,
            detail="This teacher has chapters assigned to them — reassign or delete those chapters first.",
        )

    photo_url = teacher.photo_url
    db.delete(teacher)
    db.commit()
    b2_storage.delete_object_for_url(photo_url)
