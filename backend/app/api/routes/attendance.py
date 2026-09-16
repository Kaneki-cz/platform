"""Per-student QR codes + group attendance scanning.

Two separate but related pieces:
  - Every student has a permanent code (shown as a QR on their own profile
    screen), generated lazily the first time they open that screen.
  - A teacher/admin scans that code from a specific TeacherGroup's scanner
    screen to mark the student present for today's session.

This is real in-person attendance for a physical tutoring session —
entirely separate from LessonProgress (recorded-video watch tracking) and
from LessonAccessCode (single-use, per-lecture unlock codes). See
app/models/attendance.py for why attendance is scoped to a TeacherGroup
rather than a Course/chapter.
"""
import secrets
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.attendance import AttendanceRecord
from app.models.student_group_membership import StudentGroupMembership
from app.models.teacher import TeacherProfile
from app.models.teacher_group import TeacherGroup
from app.models.user import User, UserRole
from app.schemas.attendance import (
    AttendanceRow,
    AttendanceScanRequest,
    AttendanceScanResult,
    GroupAttendanceOut,
    StudentCodeOut,
)

router = APIRouter(tags=["attendance"])

# Same alphabet as LessonAccessCode's codes (app/api/routes/lesson_access_codes.py)
# — drops visually-ambiguous characters (0/O, 1/I/L), for the rare case a
# teacher has to type a student's code by hand instead of scanning it.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _generate_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def _generate_unique_student_code(db: Session) -> str:
    """A fresh code, guaranteed not already used by another student. At
    32**8 (~1.1e12) possible codes a real collision is essentially
    impossible, but this still checks and regenerates rather than
    assuming — same defensive pattern as
    lesson_access_codes.py's _generate_unique_codes."""
    while True:
        code = _generate_code()
        if not db.query(User.id).filter(User.student_code == code).first():
            return code


def _get_group_or_404(db: Session, group_id: uuid.UUID) -> TeacherGroup:
    group = db.get(TeacherGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def _ensure_can_manage_group(db: Session, current_user: User, group: TeacherGroup) -> None:
    """Same ownership rule as enrollment.py's _require_teacher_owner_or_admin
    — an instructor may only scan/view attendance for a group under their
    OWN linked teacher profile; an admin may manage any group."""
    if current_user.role == UserRole.admin:
        return
    teacher = db.get(TeacherProfile, group.teacher_id)
    if teacher is not None and teacher.user_id == current_user.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized to manage this group's attendance")


# ── Student: their own QR code ────────────────────────────────────────────────


@router.get("/api/v1/students/me/code", response_model=StudentCodeOut)
def get_or_create_student_code(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StudentCodeOut:
    """Returns this student's permanent code, generating and persisting one
    the first time this is ever called for their account. Rendered as a QR
    code on their own profile screen — see app/(tabs)/profile.tsx (or
    wherever the mobile side puts it)."""
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=400, detail="Only student accounts have an attendance code.")

    if current_user.student_code is None:
        current_user.student_code = _generate_unique_student_code(db)
        db.commit()
        db.refresh(current_user)

    return StudentCodeOut(code=current_user.student_code)


# ── Teacher/admin: scanning + reviewing a session ─────────────────────────────


@router.post("/api/v1/attendance/scan", response_model=AttendanceScanResult)
def scan_attendance(
    payload: AttendanceScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> AttendanceScanResult:
    """Marks the student owning `code` present in `group_id` for today.
    Re-scanning the same student in the same group on the same day is a
    harmless no-op (already_marked=True on the response), never a
    duplicate row or an error — matches how the mobile scanner screen is
    meant to be left open and pointed at student after student without
    worrying about an accidental double-scan."""
    group = _get_group_or_404(db, payload.group_id)
    _ensure_can_manage_group(db, current_user, group)

    normalized = payload.code.strip().upper()
    student = db.query(User).filter(User.student_code == normalized).first()
    if not student:
        raise HTTPException(status_code=404, detail="This code isn't valid.")
    if student.role != UserRole.student:
        raise HTTPException(status_code=400, detail="This code doesn't belong to a student account.")

    # The student must already be assigned to THIS group (via enrollment) —
    # otherwise scanning a valid-but-unrelated code would silently mark
    # someone present in the wrong teacher's session.
    membership = (
        db.query(StudentGroupMembership)
        .filter(
            StudentGroupMembership.student_user_id == student.id,
            StudentGroupMembership.group_id == group.id,
        )
        .first()
    )
    if membership is None:
        raise HTTPException(status_code=400, detail="This student isn't assigned to this group.")

    today = datetime.now(timezone.utc).date()
    existing = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_user_id == student.id,
            AttendanceRecord.group_id == group.id,
            AttendanceRecord.session_date == today,
        )
        .first()
    )
    if existing is not None:
        return AttendanceScanResult(
            user_id=student.id,
            full_name=student.full_name_ar or student.full_name,
            email=student.email,
            group_id=group.id,
            group_name=group.name,
            session_date=today,
            already_marked=True,
        )

    record = AttendanceRecord(
        student_user_id=student.id,
        group_id=group.id,
        session_date=today,
        scanned_by_user_id=current_user.id,
    )
    db.add(record)
    db.commit()

    return AttendanceScanResult(
        user_id=student.id,
        full_name=student.full_name_ar or student.full_name,
        email=student.email,
        group_id=group.id,
        group_name=group.name,
        session_date=today,
        already_marked=False,
    )


@router.get(
    "/api/v1/teachers/{teacher_id}/groups/{group_id}/attendance",
    response_model=GroupAttendanceOut,
)
def get_group_attendance(
    teacher_id: uuid.UUID,
    group_id: uuid.UUID,
    session_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> GroupAttendanceOut:
    """Who's been scanned present in this group on a given day (today by
    default) — the teacher-facing review screen after running a session."""
    group = _get_group_or_404(db, group_id)
    if group.teacher_id != teacher_id:
        raise HTTPException(status_code=404, detail="Group not found for this teacher")
    _ensure_can_manage_group(db, current_user, group)

    target_date = session_date or datetime.now(timezone.utc).date()

    rows = (
        db.query(AttendanceRecord, User)
        .join(User, User.id == AttendanceRecord.student_user_id)
        .filter(AttendanceRecord.group_id == group_id, AttendanceRecord.session_date == target_date)
        .order_by(AttendanceRecord.scanned_at)
        .all()
    )

    return GroupAttendanceOut(
        group_id=group.id,
        group_name=group.name,
        session_date=target_date,
        present=[
            AttendanceRow(
                user_id=user.id,
                full_name=user.full_name_ar or user.full_name,
                email=user.email,
                scanned_at=record.scanned_at,
            )
            for record, user in rows
        ],
    )
