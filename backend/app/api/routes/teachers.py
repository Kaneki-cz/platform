"""Display-card teachers shown when a student browses a subject (e.g.
Physics -> pick a teacher -> pick a grade -> chapters). See
app/models/teacher.py for what these are and how (since 2026-09) one can
optionally be LINKED to a real instructor account, which is what actually
grants that account edit access to the chapters filed under this teacher —
see app/api/deps.py's ensure_can_manage_course.

Authoring a teacher card itself (create/update/delete) is admin-only — the
admin defines the curriculum's teacher "slots"; an instructor who gets
linked to one can then create/edit lessons+exams within the chapters filed
under it (see app/api/routes/lessons.py, exams.py, questions.py), but never
the teacher-card metadata (name/photo) or the chapter list itself.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.teacher import TeacherProfile
from app.models.user import User, UserRole
from app.schemas.teacher import TeacherCreate, TeacherLink, TeacherOut, TeacherUpdate
from app.services import b2_storage

router = APIRouter(prefix="/api/v1", tags=["teachers"])


def _teacher_out(db: Session, teacher: TeacherProfile) -> TeacherOut:
    """Builds a TeacherOut by hand, joining in the linked account's
    email/full_name when teacher.user_id is set — see TeacherOut's own
    comment on why this can't just be a bare model_validate(teacher)."""
    linked_email = None
    linked_full_name = None
    if teacher.user_id is not None:
        linked = db.get(User, teacher.user_id)
        if linked is not None:
            linked_email = linked.email
            linked_full_name = linked.full_name
    return TeacherOut(
        id=teacher.id,
        subject_id=teacher.subject_id,
        name=teacher.name,
        photo_url=teacher.photo_url,
        order_index=teacher.order_index,
        user_id=teacher.user_id,
        linked_email=linked_email,
        linked_full_name=linked_full_name,
    )


@router.get("/teachers/mine", response_model=TeacherOut)
def get_my_teacher_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TeacherOut:
    """Returns the teacher card linked to the signed-in instructor's own
    account (see TeacherProfile.user_id / link_teacher_account above) — used
    by the mobile app's self-service "My groups" screen so an instructor can
    reach their own teacher_id for the groups + attendance endpoints
    (app/api/routes/enrollment.py, attendance.py — both already permit an
    instructor to manage their own teacher_id's data) without needing to
    already have a chapter assigned (myManagedCourses can be empty for a
    freshly-linked instructor)."""
    teacher = db.query(TeacherProfile).filter(TeacherProfile.user_id == current_user.id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Your account isn't linked to a teacher profile yet — ask an admin to link it.")
    return _teacher_out(db, teacher)


@router.get("/subjects/{subject_id}/teachers", response_model=list[TeacherOut])
def list_teachers(
    subject_id: uuid.UUID,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
) -> list[TeacherOut]:
    teachers = (
        db.query(TeacherProfile)
        .filter(TeacherProfile.subject_id == subject_id)
        .order_by(TeacherProfile.order_index)
        .all()
    )
    return [_teacher_out(db, t) for t in teachers]


@router.post("/teachers", response_model=TeacherOut, status_code=201)
def create_teacher(
    payload: TeacherCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> TeacherOut:
    teacher = TeacherProfile(
        subject_id=payload.subject_id,
        name=payload.name,
        photo_url=payload.photo_url,
        order_index=payload.order_index,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return _teacher_out(db, teacher)


@router.put("/teachers/{teacher_id}", response_model=TeacherOut)
def update_teacher(
    teacher_id: uuid.UUID,
    payload: TeacherUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> TeacherOut:
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    fields = payload.model_dump(exclude_unset=True)
    old_photo_url = teacher.photo_url if "photo_url" in fields else None

    for field, value in fields.items():
        setattr(teacher, field, value)
    db.commit()
    db.refresh(teacher)

    if old_photo_url is not None and old_photo_url != teacher.photo_url:
        b2_storage.delete_object_for_url(old_photo_url)

    return _teacher_out(db, teacher)


@router.delete("/teachers/{teacher_id}", status_code=204)
def delete_teacher(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

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


@router.post("/teachers/{teacher_id}/link", response_model=TeacherOut)
def link_teacher_account(
    teacher_id: uuid.UUID,
    payload: TeacherLink,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> TeacherOut:
    """Links a real instructor account (found by email) to this teacher
    card, granting it edit access to every chapter filed under this teacher
    (see app/api/deps.py's ensure_can_manage_course). Promotes the account
    to role=instructor if it's currently just a student — mirrors the old
    SubjectInstructor assign_instructor's same promotion behavior."""
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user found with that email — they must register first")

    already_linked_elsewhere = (
        db.query(TeacherProfile)
        .filter(TeacherProfile.user_id == user.id, TeacherProfile.id != teacher_id)
        .first()
    )
    if already_linked_elsewhere:
        raise HTTPException(
            status_code=400,
            detail=f'This account is already linked to another teacher profile ("{already_linked_elsewhere.name}") — unlink it there first.',
        )

    if user.role == UserRole.student:
        user.role = UserRole.instructor

    teacher.user_id = user.id
    db.commit()
    db.refresh(teacher)
    return _teacher_out(db, teacher)


@router.delete("/teachers/{teacher_id}/link", response_model=TeacherOut)
def unlink_teacher_account(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> TeacherOut:
    """Removes this teacher card's linked account, if any — the account
    itself is untouched (still exists, keeps whatever role it has; demote it
    by hand via PUT /api/v1/admin/users/{id}/role if that's also wanted)."""
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    teacher.user_id = None
    db.commit()
    db.refresh(teacher)
    return _teacher_out(db, teacher)
