import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.lesson_access_code import LessonAccessCode
from app.models.user import User, UserRole
from app.schemas.lesson_access_code import (
    AccessCodeGenerateRequest,
    AccessCodeOut,
    AccessCodeRedeemRequest,
    AccessCodeRedeemResponse,
)

router = APIRouter(tags=["lesson-access-codes"])

# Drops visually-ambiguous characters (0/O, 1/I/L) since a student types
# these in by hand from wherever the teacher handed the code out.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _generate_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def _generate_unique_codes(db: Session, count: int) -> list[str]:
    """`count` codes, unique among themselves AND never already present in
    lesson_access_codes (checked across the WHOLE table, not just this
    lesson — codes are unique platform-wide by design). At 32**8 (~1.1e12)
    possible codes a real collision is essentially impossible, but this
    still checks and regenerates rather than assuming."""
    codes: set[str] = set()
    while len(codes) < count:
        codes.add(_generate_code())

    existing = {c for (c,) in db.query(LessonAccessCode.code).filter(LessonAccessCode.code.in_(codes)).all()}
    while existing:
        codes -= existing
        while len(codes) < count:
            codes.add(_generate_code())
        existing = {c for (c,) in db.query(LessonAccessCode.code).filter(LessonAccessCode.code.in_(codes)).all()}

    return list(codes)


def _get_lesson_or_404(db: Session, lesson_id: uuid.UUID) -> Lesson:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson


def _subject_id_of_lesson(db: Session, lesson: Lesson) -> uuid.UUID:
    course = db.get(Course, lesson.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course.subject_id


@router.get("/api/v1/lessons/{lesson_id}/codes", response_model=list[AccessCodeOut])
def list_lesson_codes(
    lesson_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> list[AccessCodeOut]:
    lesson = _get_lesson_or_404(db, lesson_id)
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))

    codes = (
        db.query(LessonAccessCode)
        .filter(LessonAccessCode.lesson_id == lesson_id)
        .order_by(LessonAccessCode.created_at)
        .all()
    )
    return [
        AccessCodeOut(
            id=c.id,
            code=c.code,
            redeemed=c.redeemed_by_user_id is not None,
            redeemed_at=c.redeemed_at,
            created_at=c.created_at,
        )
        for c in codes
    ]


@router.post("/api/v1/lessons/{lesson_id}/codes", response_model=list[AccessCodeOut], status_code=201)
def generate_lesson_codes(
    lesson_id: uuid.UUID,
    payload: AccessCodeGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> list[AccessCodeOut]:
    """Generating even one code here is what switches this lecture into
    "requires a code" mode for students going forward — see
    app/api/routes/lessons.py's get_lesson and
    app/api/routes/courses.py's _annotate_code_gate."""
    lesson = _get_lesson_or_404(db, lesson_id)
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))

    fresh_codes = _generate_unique_codes(db, payload.count)
    rows = [LessonAccessCode(lesson_id=lesson_id, code=code) for code in fresh_codes]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)

    return [
        AccessCodeOut(id=row.id, code=row.code, redeemed=False, redeemed_at=None, created_at=row.created_at)
        for row in rows
    ]


@router.delete("/api/v1/lessons/{lesson_id}/codes/{code_id}", status_code=204)
def delete_lesson_code(
    lesson_id: uuid.UUID,
    code_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    """Removes an unredeemed code (e.g. the admin generated too many by
    mistake). A code that's already been redeemed can't be deleted — that
    would silently take a video away from a student who already unlocked
    it."""
    lesson = _get_lesson_or_404(db, lesson_id)
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))

    row = (
        db.query(LessonAccessCode)
        .filter(LessonAccessCode.id == code_id, LessonAccessCode.lesson_id == lesson_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Code not found")
    if row.redeemed_by_user_id is not None:
        raise HTTPException(status_code=400, detail="This code has already been used and can't be removed.")

    db.delete(row)
    db.commit()


@router.post("/api/v1/lessons/redeem", response_model=AccessCodeRedeemResponse)
def redeem_lesson_code(
    payload: AccessCodeRedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AccessCodeRedeemResponse:
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=400, detail="Only student accounts can redeem a lecture code.")

    # Codes are generated uppercase from a fixed alphabet — normalize
    # whatever the student typed (case, stray whitespace) rather than
    # rejecting an otherwise-correct code over formatting.
    normalized = payload.code.strip().upper()
    row = db.query(LessonAccessCode).filter(LessonAccessCode.code == normalized).first()
    if not row:
        raise HTTPException(status_code=404, detail="This code isn't valid.")

    if row.redeemed_by_user_id is not None:
        if row.redeemed_by_user_id == current_user.id:
            # This same student already redeemed it earlier (e.g. a retry
            # after a flaky connection) — treat as success, not an error.
            lesson = _get_lesson_or_404(db, row.lesson_id)
            return AccessCodeRedeemResponse(lesson_id=lesson.id, course_id=lesson.course_id, lesson_title=lesson.title)
        raise HTTPException(status_code=409, detail="This code has already been used.")

    lesson = _get_lesson_or_404(db, row.lesson_id)

    row.redeemed_by_user_id = current_user.id
    row.redeemed_at = datetime.now(timezone.utc)
    db.commit()

    return AccessCodeRedeemResponse(lesson_id=lesson.id, course_id=lesson.course_id, lesson_title=lesson.title)
