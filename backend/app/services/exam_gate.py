"""Shared "which standalone exams gate this lesson, and has this student
passed them all" queries — used by both app/api/routes/courses.py (the
chapter/lecture LIST view, batched for every lesson in a course at once)
and app/api/routes/lessons.py (a single lecture fetch, which also
withholds video_url the same way it already does for max_views/access
codes). Kept in one place so the two call sites can never drift on what
"gated" and "passed" mean — see app/models/exam.py for the underlying
data model.
"""
import uuid

from sqlalchemy.orm import Session

from app.models.exam import Exam, ExamAttempt


def gating_exams_for_course(db: Session, course_id: uuid.UUID, before_order_index: int) -> list[Exam]:
    """Every Exam in `course_id` a lesson at `before_order_index` must clear
    — i.e. every exam positioned earlier in the course's lesson/exam
    ordering."""
    return (
        db.query(Exam)
        .filter(Exam.course_id == course_id, Exam.order_index < before_order_index)
        .all()
    )


def passed_exam_ids(db: Session, user_id: uuid.UUID, exam_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """The subset of `exam_ids` this user has PASSED on at least one
    attempt (best-attempt semantics — a single passing attempt counts
    forever, same as quiz_passed elsewhere on this platform)."""
    if not exam_ids:
        return set()
    rows = (
        db.query(ExamAttempt.exam_id)
        .filter(
            ExamAttempt.user_id == user_id,
            ExamAttempt.exam_id.in_(exam_ids),
            ExamAttempt.passed.is_(True),
        )
        .distinct()
        .all()
    )
    return {row[0] for row in rows}


def is_locked_by_exam(
    db: Session,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    lesson_order_index: int,
    lesson_exempt: bool,
) -> bool:
    """True iff a student must pass one or more standalone exams before
    reaching a lesson at `lesson_order_index` in `course_id`, and hasn't
    passed all of them yet. Callers are responsible for the staff-exempt
    check (only ever call this for role=student) — see
    app/api/routes/lessons.py's get_lesson and
    app/api/routes/courses.py's _annotate_exam_gate."""
    if lesson_exempt:
        return False
    exams = gating_exams_for_course(db, course_id, lesson_order_index)
    if not exams:
        return False
    passed = passed_exam_ids(db, user_id, [e.id for e in exams])
    return not all(e.id in passed for e in exams)
