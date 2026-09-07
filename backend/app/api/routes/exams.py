"""Standalone exams — separate from the in-video segment quizzes handled in
app/api/routes/questions.py. An exam sits at a specific point in a course's
lesson order (Exam.order_index, sharing Lesson.order_index's numbering
space) and gates every lesson after it until the student passes it — see
app/services/exam_gate.py for the enforcement, applied in both
app/api/routes/courses.py (the chapter/lecture LIST) and
app/api/routes/lessons.py (a single lecture fetch).

Exam QUESTIONS are authored through the existing question endpoints (see
app/api/routes/questions.py, extended to accept exam_id as well as
lesson_id) — only the student-facing take/submit flow lives here, because
unlike a segment quiz (graded question-by-question, immediately) an exam
is answered all at once and graded as a whole, with a server-anchored
timer between start and submit.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.exam import Exam, ExamAttempt
from app.models.question import Question, QuestionAttempt
from app.models.user import User
from app.schemas.exam import (
    ExamAnswerResult,
    ExamCreate,
    ExamOut,
    ExamQuestionForStudent,
    ExamStartOut,
    ExamStatusOut,
    ExamSubmitRequest,
    ExamSubmitResult,
    ExamUpdate,
)

router = APIRouter(prefix="/api/v1/exams", tags=["exams"])


def _grade(question: Question, submitted_answer: str) -> bool:
    return submitted_answer.strip().lower() == question.correct_answer.strip().lower()


def _subject_id_of_exam(db: Session, exam: Exam) -> uuid.UUID:
    course = db.get(Course, exam.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course.subject_id


def _question_count(db: Session, exam_id: uuid.UUID) -> int:
    return db.query(Question).filter(Question.exam_id == exam_id).count()


def _best_attempt(db: Session, exam_id: uuid.UUID, user_id: uuid.UUID) -> ExamAttempt | None:
    return (
        db.query(ExamAttempt)
        .filter(ExamAttempt.exam_id == exam_id, ExamAttempt.user_id == user_id, ExamAttempt.passed.is_(True))
        .order_by(ExamAttempt.score_percent.desc())
        .first()
    )


# --- Instructor/admin: authoring --------------------------------------------


@router.get("/course/{course_id}", response_model=list[ExamOut])
def list_course_exams(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> list[ExamOut]:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_subject(db, current_user, course.subject_id)

    exams = db.query(Exam).filter(Exam.course_id == course_id).order_by(Exam.order_index).all()
    result = []
    for exam in exams:
        out = ExamOut.model_validate(exam)
        out.question_count = _question_count(db, exam.id)
        result.append(out)
    return result


@router.post("", response_model=ExamOut, status_code=201)
def create_exam(
    payload: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> ExamOut:
    course = db.get(Course, payload.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_subject(db, current_user, course.subject_id)

    exam = Exam(
        course_id=payload.course_id,
        title=payload.title,
        description=payload.description,
        order_index=payload.order_index,
        passing_percent=payload.passing_percent,
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    out = ExamOut.model_validate(exam)
    out.question_count = 0
    return out


@router.get("/{exam_id}", response_model=ExamOut)
def get_exam(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> ExamOut:
    """Single-exam fetch for the admin exam-questions management screen
    (app/admin/exam/[id].tsx on the mobile side), which only has the exam's
    id in its route params — list_course_exams above needs the course_id
    instead, which that screen doesn't have handy."""
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_exam(db, exam))
    out = ExamOut.model_validate(exam)
    out.question_count = _question_count(db, exam.id)
    return out


@router.put("/{exam_id}", response_model=ExamOut)
def update_exam(
    exam_id: uuid.UUID,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> ExamOut:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_exam(db, exam))

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(exam, field, value)
    db.commit()
    db.refresh(exam)
    out = ExamOut.model_validate(exam)
    out.question_count = _question_count(db, exam.id)
    return out


@router.delete("/{exam_id}", status_code=204)
def delete_exam(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_exam(db, exam))
    db.delete(exam)
    db.commit()


# --- Student: taking the exam ------------------------------------------------


@router.get("/{exam_id}/status", response_model=ExamStatusOut)
def get_exam_status(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExamStatusOut:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    best = _best_attempt(db, exam_id, current_user.id)
    in_progress = (
        db.query(ExamAttempt)
        .filter(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.user_id == current_user.id,
            ExamAttempt.submitted_at.is_(None),
        )
        .order_by(ExamAttempt.started_at.desc())
        .first()
    )
    return ExamStatusOut(
        passed=best is not None,
        best_score_percent=best.score_percent if best else None,
        in_progress_attempt_id=in_progress.id if in_progress else None,
        in_progress_started_at=in_progress.started_at if in_progress else None,
    )


@router.post("/{exam_id}/start", response_model=ExamStartOut)
def start_exam(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExamStartOut:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    questions = db.query(Question).filter(Question.exam_id == exam_id).order_by(Question.id).all()
    if not questions:
        raise HTTPException(status_code=400, detail="This exam has no questions yet.")

    # Resume an already-open attempt instead of starting a second one in
    # parallel — keeps the server-anchored started_at (and therefore the
    # timer) honest across an app restart or a dropped connection, and
    # stops a student from "resetting the clock" by abandoning a slow
    # attempt and starting fresh. See ExamAttempt's docstring.
    existing = (
        db.query(ExamAttempt)
        .filter(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.user_id == current_user.id,
            ExamAttempt.submitted_at.is_(None),
        )
        .order_by(ExamAttempt.started_at.desc())
        .first()
    )
    if existing is not None:
        attempt = existing
    else:
        attempt = ExamAttempt(exam_id=exam_id, user_id=current_user.id)
        db.add(attempt)
        db.commit()
        db.refresh(attempt)

    return ExamStartOut(
        attempt_id=attempt.id,
        started_at=attempt.started_at,
        passing_percent=exam.passing_percent,
        questions=[ExamQuestionForStudent.model_validate(q) for q in questions],
    )


@router.post("/attempts/{attempt_id}/submit", response_model=ExamSubmitResult)
def submit_exam(
    attempt_id: uuid.UUID,
    payload: ExamSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExamSubmitResult:
    attempt = db.get(ExamAttempt, attempt_id)
    if not attempt or attempt.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.submitted_at is not None:
        raise HTTPException(status_code=409, detail="This attempt was already submitted.")

    exam = db.get(Exam, attempt.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    questions = {q.id: q for q in db.query(Question).filter(Question.exam_id == exam.id).all()}
    if not questions:
        raise HTTPException(status_code=400, detail="This exam has no questions.")

    results: list[ExamAnswerResult] = []
    correct_count = 0
    for answer in payload.answers:
        question = questions.get(answer.question_id)
        if question is None:
            continue  # ignore an answer for a question that isn't part of this exam
        is_correct = _grade(question, answer.submitted_answer)
        if is_correct:
            correct_count += 1
        db.add(
            QuestionAttempt(
                user_id=current_user.id,
                question_id=question.id,
                exam_attempt_id=attempt.id,
                submitted_answer=answer.submitted_answer,
                is_correct=is_correct,
            )
        )
        results.append(
            ExamAnswerResult(
                question_id=question.id,
                is_correct=is_correct,
                correct_answer=question.correct_answer,
                explanation=question.explanation,
            )
        )

    total_count = len(questions)
    score_percent = (correct_count / total_count) * 100 if total_count else 0.0
    passed = score_percent >= exam.passing_percent

    now = datetime.now(timezone.utc)
    attempt.submitted_at = now
    attempt.score_percent = score_percent
    attempt.passed = passed
    attempt.duration_seconds = int((now - attempt.started_at).total_seconds())
    db.commit()

    return ExamSubmitResult(
        score_percent=score_percent,
        passed=passed,
        correct_count=correct_count,
        total_count=total_count,
        duration_seconds=attempt.duration_seconds,
        answers=results,
    )
