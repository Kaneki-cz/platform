import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.subject import Subject
from app.models.user import User
from app.schemas.subject import SubjectCreate, SubjectDetailOut, SubjectOut
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


@router.get("/mine/managed", response_model=list[SubjectOut])
def my_managed_subjects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[Subject]:
    """Every subject, for an admin only — this backs the admin home screen's
    "All subjects" browse-by-subject flow (create/rename subjects, manage
    their teacher cards and chapters). An instructor no longer browses by
    subject at all: since 2026-09 their edit access is scoped to specific
    chapters via their linked teacher card (app/models/teacher.py's user_id
    — see app/api/deps.py's ensure_can_manage_course), so the mobile admin
    home screen calls GET /api/v1/courses/mine/managed for them instead
    (a flat list of the chapters they can add lessons/exams to). This old
    subject-wide SubjectInstructor grant (app/models/subject.py) is kept in
    the DB but no longer consulted by any permission check, so an instructor
    always gets [] here now."""
    if current_user.role == current_user.role.admin:
        return db.query(Subject).order_by(Subject.order_index).all()
    return []
