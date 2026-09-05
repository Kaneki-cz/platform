import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.subject import Subject, SubjectInstructor
from app.models.user import User
from app.schemas.subject import InstructorAssign, InstructorOut, SubjectCreate, SubjectDetailOut, SubjectOut
from app.services import b2_storage

router = APIRouter(prefix="/api/v1/subjects", tags=["subjects"])


@router.get("", response_model=list[SubjectOut])
def list_subjects(db: Session = Depends(get_db), _=Depends(get_current_user)) -> list[Subject]:
    return db.query(Subject).order_by(Subject.order_index).all()


@router.get("/{subject_id}", response_model=SubjectDetailOut)
def get_subject(subject_id: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_user)) -> Subject:
    subject = (
        db.query(Subject)
        .options(selectinload(Subject.courses))
        .filter(Subject.id == subject_id)
        .first()
    )
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return subject


@router.post("", response_model=SubjectOut, status_code=201)
def create_subject(
    payload: SubjectCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Subject:
    if db.query(Subject).filter(Subject.name == payload.name).first():
        raise HTTPException(status_code=400, detail="A subject with this name already exists")
    subject = Subject(name=payload.name, order_index=payload.order_index)
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.delete("/{subject_id}", status_code=204)
def delete_subject(
    subject_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    """Deletes a subject and, via cascade="all, delete-orphan" on
    Subject.courses (which itself cascades to Course.lessons) AND on
    Subject.teachers, every chapter, lecture, and teacher-card inside it
    too. Admin-only, same as creating a subject.

    Same gap as delete_course had (now fixed there): the ORM cascade above
    deletes every nested Course/Lesson/TeacherProfile row in the DB, but it
    never runs our R2 cleanup code per row, so every chapter's cover image,
    every lecture's video, AND every teacher's photo across the whole
    subject would silently orphan in R2 forever. Collect all of it up
    front — before the delete — since none of it is reachable anymore once
    the transaction commits.
    """
    subject = (
        db.query(Subject)
        .options(
            selectinload(Subject.courses).selectinload(Course.lessons),
            selectinload(Subject.teachers),
        )
        .filter(Subject.id == subject_id)
        .first()
    )
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    stale_urls = []
    for course in subject.courses:
        stale_urls.append(course.cover_image_url)
        stale_urls.extend(lesson.video_url for lesson in course.lessons)
    stale_urls.extend(teacher.photo_url for teacher in subject.teachers)

    db.delete(subject)
    db.commit()

    for url in stale_urls:
        b2_storage.delete_object_for_url(url)


@router.get("/{subject_id}/instructors", response_model=list[InstructorOut])
def list_instructors(
    subject_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[InstructorOut]:
    rows = (
        db.query(SubjectInstructor)
        .join(User, User.id == SubjectInstructor.user_id)
        .filter(SubjectInstructor.subject_id == subject_id)
        .all()
    )
    return [
        InstructorOut(user_id=row.user_id, email=row.user.email, full_name=row.user.full_name) for row in rows
    ]


@router.post("/{subject_id}/instructors", response_model=InstructorOut, status_code=201)
def assign_instructor(
    subject_id: uuid.UUID,
    payload: InstructorAssign,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> InstructorOut:
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user found with that email — they must register first")

    existing = (
        db.query(SubjectInstructor)
        .filter(SubjectInstructor.subject_id == subject_id, SubjectInstructor.user_id == user.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This user is already an instructor for this subject")

    # Promote to instructor if they're currently just a student (never demotes an admin).
    if user.role == user.role.student:
        user.role = user.role.instructor

    db.add(SubjectInstructor(subject_id=subject_id, user_id=user.id))
    db.commit()
    return InstructorOut(user_id=user.id, email=user.email, full_name=user.full_name)


@router.delete("/{subject_id}/instructors/{user_id}", status_code=204)
def unassign_instructor(
    subject_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    row = (
        db.query(SubjectInstructor)
        .filter(SubjectInstructor.subject_id == subject_id, SubjectInstructor.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="This user is not an instructor for this subject")
    db.delete(row)
    db.commit()


@router.get("/mine/managed", response_model=list[SubjectOut])
def my_managed_subjects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[Subject]:
    """Subjects the current user can add content to: all of them for an
    admin, just their assignments for an instructor, none for a student."""
    if current_user.role == current_user.role.admin:
        return db.query(Subject).order_by(Subject.order_index).all()
    if current_user.role == current_user.role.instructor:
        return (
            db.query(Subject)
            .join(SubjectInstructor, SubjectInstructor.subject_id == Subject.id)
            .filter(SubjectInstructor.user_id == current_user.id)
            .order_by(Subject.order_index)
            .all()
        )
    return []
