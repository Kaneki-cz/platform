import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.database import get_db
from app.models.student_group_membership import StudentGroupMembership
from app.models.teacher import TeacherProfile
from app.models.teacher_group import TeacherGroup
from app.models.user import User, UserRole
from app.schemas.enrollment import (
    AdminEnrollmentOut,
    AdminGroupUpdate,
    EnrollmentStatusOut,
    EnrollmentSubmit,
    TeacherGroupCreate,
    TeacherGroupOut,
)

router = APIRouter(tags=["enrollment"])


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_teacher_or_404(db: Session, teacher_id: uuid.UUID) -> TeacherProfile:
    teacher = db.get(TeacherProfile, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return teacher


def _require_teacher_owner_or_admin(teacher: TeacherProfile, current_user: User) -> None:
    """Instructors may only manage their OWN teacher profile's groups.
    Admins may manage any teacher's groups."""
    if current_user.role == UserRole.admin:
        return
    if current_user.role == UserRole.instructor and teacher.user_id == current_user.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized to manage this teacher's groups")


def _load_available_groups(db: Session, teacher_id: uuid.UUID) -> list[TeacherGroup]:
    return (
        db.query(TeacherGroup)
        .filter(TeacherGroup.teacher_id == teacher_id)
        .order_by(TeacherGroup.created_at)
        .all()
    )


# ── Teacher group management ──────────────────────────────────────────────────


@router.get("/api/v1/teachers/{teacher_id}/groups", response_model=list[TeacherGroupOut])
def list_teacher_groups(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TeacherGroup]:
    """List all groups for a teacher. Visible to any authenticated user so
    students can see their options during enrollment."""
    _get_teacher_or_404(db, teacher_id)
    return _load_available_groups(db, teacher_id)


@router.post(
    "/api/v1/teachers/{teacher_id}/groups",
    response_model=TeacherGroupOut,
    status_code=201,
)
def create_teacher_group(
    teacher_id: uuid.UUID,
    payload: TeacherGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TeacherGroup:
    """Create a new group for a teacher. Only the linked instructor or an
    admin may do this."""
    teacher = _get_teacher_or_404(db, teacher_id)
    _require_teacher_owner_or_admin(teacher, current_user)
    group = TeacherGroup(teacher_id=teacher_id, name=payload.name)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.delete(
    "/api/v1/teachers/{teacher_id}/groups/{group_id}",
    status_code=204,
)
def delete_teacher_group(
    teacher_id: uuid.UUID,
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a group. Existing memberships pointing at this group have their
    group_id set to NULL by the DB (ON DELETE SET NULL) — students become
    unassigned but stay enrolled."""
    teacher = _get_teacher_or_404(db, teacher_id)
    _require_teacher_owner_or_admin(teacher, current_user)
    group = db.get(TeacherGroup, group_id)
    if not group or group.teacher_id != teacher_id:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(group)
    db.commit()


# ── Student enrollment ────────────────────────────────────────────────────────


@router.get("/api/v1/enrollment/{teacher_id}", response_model=EnrollmentStatusOut)
def get_enrollment_status(
    teacher_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrollmentStatusOut:
    """Check whether the current student is enrolled for this teacher.

    Called by the mobile lesson screen right after lesson data loads, to
    decide whether to show EnrollmentModal.
    """
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Students only")
    _get_teacher_or_404(db, teacher_id)

    available_groups = _load_available_groups(db, teacher_id)
    membership = (
        db.query(StudentGroupMembership)
        .filter(
            StudentGroupMembership.student_user_id == current_user.id,
            StudentGroupMembership.teacher_id == teacher_id,
        )
        .first()
    )

    enrolled = membership is not None
    # needs_group: already enrolled but group_id is NULL while groups exist —
    # teacher added groups after the student first enrolled.
    needs_group = enrolled and membership.group_id is None and len(available_groups) > 0

    return EnrollmentStatusOut(
        enrolled=enrolled,
        needs_group=needs_group,
        available_groups=[TeacherGroupOut.model_validate(g) for g in available_groups],
        current_group_id=membership.group_id if membership else None,
        full_name_ar=current_user.full_name_ar,
        grade=current_user.grade,
    )


@router.post("/api/v1/enrollment/{teacher_id}", response_model=EnrollmentStatusOut)
def submit_enrollment(
    teacher_id: uuid.UUID,
    payload: EnrollmentSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrollmentStatusOut:
    """Create or update the student's enrollment for this teacher.

    Upserts the membership row and updates full_name_ar + grade on the User
    (global — one name/grade for the whole app).
    """
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Students only")
    _get_teacher_or_404(db, teacher_id)

    # Validate group belongs to this teacher (if provided)
    if payload.group_id is not None:
        group = db.get(TeacherGroup, payload.group_id)
        if not group or group.teacher_id != teacher_id:
            raise HTTPException(status_code=400, detail="Invalid group for this teacher")

    # Update global fields on User
    current_user.full_name_ar = payload.full_name_ar
    current_user.grade = payload.grade

    # Upsert membership
    membership = (
        db.query(StudentGroupMembership)
        .filter(
            StudentGroupMembership.student_user_id == current_user.id,
            StudentGroupMembership.teacher_id == teacher_id,
        )
        .first()
    )
    if membership is None:
        membership = StudentGroupMembership(
            student_user_id=current_user.id,
            teacher_id=teacher_id,
            group_id=payload.group_id,
        )
        db.add(membership)
    else:
        membership.group_id = payload.group_id

    db.commit()
    db.refresh(current_user)

    available_groups = _load_available_groups(db, teacher_id)

    return EnrollmentStatusOut(
        enrolled=True,
        needs_group=False,
        available_groups=[TeacherGroupOut.model_validate(g) for g in available_groups],
        current_group_id=membership.group_id,
        full_name_ar=current_user.full_name_ar,
        grade=current_user.grade,
    )


# ── Admin: view / update any student's enrollments ────────────────────────────


@router.get(
    "/api/v1/admin/enrollment/users/{user_id}",
    response_model=list[AdminEnrollmentOut],
)
def admin_list_user_enrollments(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[AdminEnrollmentOut]:
    """List all teacher enrollments for a student (admin only)."""
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")

    rows = (
        db.query(StudentGroupMembership, TeacherGroup)
        .outerjoin(TeacherGroup, TeacherGroup.id == StudentGroupMembership.group_id)
        .filter(StudentGroupMembership.student_user_id == user_id)
        .all()
    )

    result = []
    for mem, grp in rows:
        teacher = db.get(TeacherProfile, mem.teacher_id)
        result.append(
            AdminEnrollmentOut(
                teacher_id=mem.teacher_id,
                teacher_name=teacher.name if teacher else None,
                group_id=mem.group_id,
                group_name=grp.name if grp else None,
            )
        )
    return result


@router.put(
    "/api/v1/admin/enrollment/users/{user_id}/teachers/{teacher_id}",
    response_model=EnrollmentStatusOut,
)
def admin_update_user_enrollment(
    user_id: uuid.UUID,
    teacher_id: uuid.UUID,
    payload: AdminGroupUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> EnrollmentStatusOut:
    """Admin reassigns a student's group for a specific teacher (or clears it
    by passing group_id: null)."""
    student = db.get(User, user_id)
    if not student:
        raise HTTPException(status_code=404, detail="User not found")
    _get_teacher_or_404(db, teacher_id)

    if payload.group_id is not None:
        group = db.get(TeacherGroup, payload.group_id)
        if not group or group.teacher_id != teacher_id:
            raise HTTPException(status_code=400, detail="Invalid group for this teacher")

    membership = (
        db.query(StudentGroupMembership)
        .filter(
            StudentGroupMembership.student_user_id == user_id,
            StudentGroupMembership.teacher_id == teacher_id,
        )
        .first()
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="No enrollment found for this student + teacher")

    membership.group_id = payload.group_id
    db.commit()

    available_groups = _load_available_groups(db, teacher_id)

    return EnrollmentStatusOut(
        enrolled=True,
        needs_group=membership.group_id is None and len(available_groups) > 0,
        available_groups=[TeacherGroupOut.model_validate(g) for g in available_groups],
        current_group_id=membership.group_id,
        full_name_ar=student.full_name_ar,
        grade=student.grade,
    )
