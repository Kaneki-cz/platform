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
import random
from pathlib import Path
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_course, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.exam import Exam, ExamAttempt
from app.models.question import Question, QuestionAttempt
from app.models.user import User
from app.services import activity, b2_storage
from app.schemas.exam import (
    ExamAnswerResult,
    ExamAttemptRow,
    ExamAnalyticsOut,
    ExamAttemptsOut,
    ExamCreate,
    ExamDraftIn,
    ExamHistoryRow,
    ExamOut,
    ExamQuestionForStudent,
    ExamStartOut,
    ExamStatusOut,
    ExamSubmitRequest,
    ExamSubmitResult,
    ExamUpdate,
    ChoiceCount,
    QuestionAnalytics,
    ReviewIn,
    ReviewItem,
    ReviewResult,
    AnswerPhotoUploadIn,
    AnswerPhotoUploadOut,
)

router = APIRouter(prefix="/api/v1/exams", tags=["exams"])

# An attempt whose average time-per-question falls below this is flagged
# as suspiciously fast on the teacher-facing attempts list (ExamAttemptRow.
# is_fast) — a nudge, not an enforced rule (per the user's explicit call:
# flag it, never block the student). 8s/question is comfortably below even
# a quick confident read-and-answer for this platform's question style.
FAST_ATTEMPT_SECONDS_PER_QUESTION = 8


def _grade(question: Question, submitted_answer: str) -> bool:
    return submitted_answer.strip().lower() == question.correct_answer.strip().lower()


# Network slack after a time limit runs out: a submit/autosave that arrives
# within this many seconds of the deadline is still accepted as-is.
TIME_LIMIT_GRACE_SECONDS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _deadline(attempt: ExamAttempt, exam: Exam) -> datetime | None:
    if not exam.time_limit_minutes:
        return None
    return attempt.started_at + timedelta(minutes=exam.time_limit_minutes)


def _is_expired(attempt: ExamAttempt, exam: Exam) -> bool:
    deadline = _deadline(attempt, exam)
    return deadline is not None and _now() > deadline + timedelta(seconds=TIME_LIMIT_GRACE_SECONDS)


ESSAY = "essay"


def _finalize_attempt(
    db: Session,
    attempt: ExamAttempt,
    exam: Exam,
    answers: dict[str, str],
    *,
    auto: bool,
) -> ExamSubmitResult:
    """Grades and closes an attempt. Score = points earned / total points of
    every question currently in the exam (an unanswered question earns 0).
    Essay answers are stored for the teacher: the attempt then stays
    pending_review — score_percent NULL, passed False — until all of them
    are graded (see review_answer)."""
    questions = db.query(Question).filter(Question.exam_id == exam.id).all()
    if not questions:
        raise HTTPException(status_code=400, detail="This exam has no questions.")

    earned = 0.0
    pending = False
    for question in questions:
        submitted = (answers.get(str(question.id)) or "").strip()
        if not submitted:
            continue
        if question.question_type == ESSAY:
            if submitted.startswith(b2_storage.B2_URL_SCHEME) and not _is_own_answer_photo(attempt, submitted):
                continue  # someone else's file — treat as unanswered
            pending = True
            db.add(
                QuestionAttempt(
                    user_id=attempt.user_id,
                    question_id=question.id,
                    exam_attempt_id=attempt.id,
                    submitted_answer=submitted,
                    is_correct=False,
                    needs_review=True,
                )
            )
            continue
        is_correct = _grade(question, submitted)
        points = float(question.points or 1) if is_correct else 0.0
        earned += points
        db.add(
            QuestionAttempt(
                user_id=attempt.user_id,
                question_id=question.id,
                exam_attempt_id=attempt.id,
                submitted_answer=submitted,
                is_correct=is_correct,
                points_awarded=points,
            )
        )

    total = float(sum(q.points or 1 for q in questions))

    # An auto-submitted attempt "ended" at its deadline, not whenever the
    # server happened to notice it was overdue.
    now = _now()
    deadline = _deadline(attempt, exam)
    ended_at = min(now, deadline) if (auto and deadline) else now

    attempt.submitted_at = now
    attempt.duration_seconds = max(0, int((ended_at - attempt.started_at).total_seconds()))
    attempt.auto_submitted = auto
    attempt.draft_answers = None
    attempt.flagged_questions = None
    attempt.earned_points = earned
    attempt.total_points = total
    attempt.pending_review = pending
    if pending:
        attempt.score_percent = None
        attempt.passed = False
    else:
        attempt.score_percent = (earned / total) * 100 if total else 0.0
        attempt.passed = attempt.score_percent >= exam.passing_percent
    db.commit()
    return _build_result(db, attempt, exam)


IMAGE_EXTENSIONS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def _is_own_answer_photo(attempt: ExamAttempt, value: str | None) -> bool:
    return bool(value) and value.startswith(f"{b2_storage.B2_URL_SCHEME}{b2_storage.ANSWER_KEY_PREFIX}{attempt.id}/")


def _answer_image_url(attempt: ExamAttempt, value: str | None) -> str | None:
    # A signed view link for a photo answer belonging to this attempt.
    if not _is_own_answer_photo(attempt, value) or not b2_storage.b2_configured():
        return None
    try:
        return b2_storage.generate_signed_video_url(value[len(b2_storage.B2_URL_SCHEME):])
    except Exception:  # noqa: BLE001 - a missing link must not break the result screen
        return None


def _build_result(db: Session, attempt: ExamAttempt, exam: Exam) -> ExamSubmitResult:
    """The result screen for a submitted attempt, rebuilt from what's stored
    — used right after submitting and when a student reopens an old one
    (e.g. after the teacher graded their essay answers)."""
    questions = db.query(Question).filter(Question.exam_id == exam.id).all()
    rows = {
        qa.question_id: qa
        for qa in db.query(QuestionAttempt).filter(QuestionAttempt.exam_attempt_id == attempt.id).all()
    }
    order = {qid: i for i, qid in enumerate(attempt.question_order or [])}
    questions.sort(key=lambda q: (order.get(str(q.id), len(order)), str(q.id)))

    reveal = (attempt.passed or exam.show_answers_on_fail) and not attempt.pending_review
    answers: list[ExamAnswerResult] = []
    for q in questions:
        row = rows.get(q.id)
        answers.append(
            ExamAnswerResult(
                question_id=q.id,
                is_correct=bool(row and row.is_correct),
                correct_answer=(q.correct_answer or None) if reveal else None,
                explanation=q.explanation if reveal else None,
                question_type=q.question_type,
                prompt=q.prompt,
                points=q.points or 1,
                points_awarded=(row.points_awarded if row else 0.0),
                pending_review=bool(row and row.needs_review),
                teacher_comment=row.teacher_comment if row else None,
                submitted_answer=row.submitted_answer if row else None,
                answer_image_url=_answer_image_url(attempt, row.submitted_answer) if row else None,
            )
        )
    return ExamSubmitResult(
        attempt_id=attempt.id,
        score_percent=attempt.score_percent,
        passed=attempt.passed,
        correct_count=sum(1 for r in rows.values() if r.is_correct),
        total_count=len(questions),
        duration_seconds=attempt.duration_seconds or 0,
        answers=answers,
        answers_revealed=reveal,
        auto_submitted=attempt.auto_submitted,
        earned_points=attempt.earned_points,
        total_points=attempt.total_points,
        pending_review=attempt.pending_review,
    )


def _recompute_attempt(db: Session, attempt: ExamAttempt, exam: Exam) -> None:
    """After a teacher grades an essay: once nothing on the attempt still
    needs review, give it its final score."""
    rows = db.query(QuestionAttempt).filter(QuestionAttempt.exam_attempt_id == attempt.id).all()
    if any(r.needs_review for r in rows):
        attempt.pending_review = True
        attempt.score_percent = None
        attempt.passed = False
        return
    total = attempt.total_points
    if not total:
        total = float(sum(q.points or 1 for q in db.query(Question).filter(Question.exam_id == exam.id).all()))
        attempt.total_points = total
    earned = float(sum(r.points_awarded or 0 for r in rows))
    attempt.earned_points = earned
    attempt.pending_review = False
    attempt.score_percent = (earned / total) * 100 if total else 0.0
    attempt.passed = attempt.score_percent >= exam.passing_percent


def _exam_out(db: Session, exam: Exam) -> ExamOut:
    out = ExamOut.model_validate(exam)
    questions = db.query(Question.points).filter(Question.exam_id == exam.id).all()
    out.question_count = len(questions)
    out.total_points = int(sum((p or 1) for (p,) in questions))
    out.pending_reviews = (
        db.query(QuestionAttempt)
        .join(ExamAttempt, ExamAttempt.id == QuestionAttempt.exam_attempt_id)
        .filter(ExamAttempt.exam_id == exam.id, QuestionAttempt.needs_review.is_(True))
        .count()
    )
    return out


def _close_if_expired(db: Session, attempt: ExamAttempt | None, exam: Exam) -> ExamAttempt | None:
    """Auto-submits an in-progress attempt whose time limit has run out
    (grading its saved draft) and returns None; otherwise returns it as-is.
    Called lazily wherever an attempt is looked at, so no background job is
    needed."""
    if attempt is None or attempt.submitted_at is not None:
        return attempt
    if _is_expired(attempt, exam):
        _finalize_attempt(db, attempt, exam, attempt.draft_answers or {}, auto=True)
        return None
    return attempt


def _in_progress_attempt(db: Session, exam: Exam, user_id: uuid.UUID) -> ExamAttempt | None:
    attempt = (
        db.query(ExamAttempt)
        .filter(
            ExamAttempt.exam_id == exam.id,
            ExamAttempt.user_id == user_id,
            ExamAttempt.submitted_at.is_(None),
        )
        .order_by(ExamAttempt.started_at.desc())
        .first()
    )
    return _close_if_expired(db, attempt, exam)


def _start_block(db: Session, exam: Exam, user_id: uuid.UUID) -> tuple[str | None, datetime | None, list[ExamAttempt]]:
    """Why a NEW attempt can't start right now (or None), when the cooldown
    ends, and the student's submitted attempts newest first."""
    submitted = (
        db.query(ExamAttempt)
        .filter(
            ExamAttempt.exam_id == exam.id,
            ExamAttempt.user_id == user_id,
            ExamAttempt.submitted_at.isnot(None),
        )
        .order_by(ExamAttempt.submitted_at.desc())
        .all()
    )
    if _question_count(db, exam.id) == 0:
        return "no_questions", None, submitted
    if exam.max_attempts and len(submitted) >= exam.max_attempts:
        return "max_attempts", None, submitted
    if exam.retake_cooldown_minutes and submitted:
        next_at = submitted[0].submitted_at + timedelta(minutes=exam.retake_cooldown_minutes)
        if next_at > _now():
            return "cooldown", next_at, submitted
    return None, None, submitted


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
    ensure_can_manage_course(db, current_user, course_id)

    exams = db.query(Exam).filter(Exam.course_id == course_id).order_by(Exam.order_index).all()
    result = []
    for exam in exams:
        result.append(_exam_out(db, exam))
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
    ensure_can_manage_course(db, current_user, payload.course_id)

    exam = Exam(
        course_id=payload.course_id,
        title=payload.title,
        description=payload.description,
        order_index=payload.order_index,
        passing_percent=payload.passing_percent,
        time_limit_minutes=payload.time_limit_minutes,
        max_attempts=payload.max_attempts,
        retake_cooldown_minutes=payload.retake_cooldown_minutes,
        shuffle_questions=payload.shuffle_questions,
        shuffle_choices=payload.shuffle_choices,
        show_answers_on_fail=payload.show_answers_on_fail,
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
    ensure_can_manage_course(db, current_user, exam.course_id)
    return _exam_out(db, exam)


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
    ensure_can_manage_course(db, current_user, exam.course_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(exam, field, value)
    db.commit()
    db.refresh(exam)
    return _exam_out(db, exam)


@router.get("/{exam_id}/attempts", response_model=ExamAttemptsOut)
def list_exam_attempts(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> ExamAttemptsOut:
    """Teacher-facing "grades" view for one exam — every completed attempt
    (submitted_at set; an abandoned in-progress attempt never shows up
    here), newest first, with is_fast flagging a suspiciously quick one.
    Same access rule as every other exam-management endpoint: admins see
    any exam, an instructor only one in a chapter their linked teacher card
    owns (see ensure_can_manage_course)."""
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_course(db, current_user, exam.course_id)

    # Grade any attempt whose time ran out while the student was away, so
    # it shows up here instead of sitting "in progress" forever.
    if exam.time_limit_minutes:
        overdue = (
            db.query(ExamAttempt)
            .filter(ExamAttempt.exam_id == exam_id, ExamAttempt.submitted_at.is_(None))
            .all()
        )
        for attempt in overdue:
            _close_if_expired(db, attempt, exam)

    question_count = _question_count(db, exam_id)

    rows = (
        db.query(ExamAttempt, User)
        .join(User, User.id == ExamAttempt.user_id)
        .filter(ExamAttempt.exam_id == exam_id, ExamAttempt.submitted_at.isnot(None))
        .order_by(ExamAttempt.submitted_at.desc())
        .all()
    )

    # Raw correct-answer count per attempt — QuestionAttempt.exam_attempt_id
    # groups a sitting's answers together (see that model's docstring), so
    # this is a single grouped count rather than N+1 queries per attempt.
    attempt_ids = [attempt.id for attempt, _ in rows]
    correct_counts: dict[uuid.UUID, int] = {}
    if attempt_ids:
        correct_counts = dict(
            db.query(QuestionAttempt.exam_attempt_id, func.count(QuestionAttempt.id))
            .filter(QuestionAttempt.exam_attempt_id.in_(attempt_ids), QuestionAttempt.is_correct.is_(True))
            .group_by(QuestionAttempt.exam_attempt_id)
            .all()
        )

    attempts: list[ExamAttemptRow] = []
    for attempt, user in rows:
        is_fast = (
            question_count > 0
            and attempt.duration_seconds is not None
            and (attempt.duration_seconds / question_count) < FAST_ATTEMPT_SECONDS_PER_QUESTION
        )
        attempts.append(
            ExamAttemptRow(
                attempt_id=attempt.id,
                user_id=user.id,
                full_name=user.full_name_ar or user.full_name,
                email=user.email,
                score_percent=attempt.score_percent,
                correct_count=correct_counts.get(attempt.id, 0),
                passed=attempt.passed,
                duration_seconds=attempt.duration_seconds,
                started_at=attempt.started_at,
                submitted_at=attempt.submitted_at,
                is_fast=is_fast,
                pending_review=attempt.pending_review,
            )
        )

    return ExamAttemptsOut(
        exam_id=exam.id,
        exam_title=exam.title,
        question_count=question_count,
        attempts=attempts,
    )


@router.get("/{exam_id}/analytics", response_model=ExamAnalyticsOut)
def exam_analytics(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> ExamAnalyticsOut:
    """Overall results and per-question difficulty for one exam, built from
    submitted attempts only. Same access rule as the attempts list."""
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_course(db, current_user, exam.course_id)

    attempts = (
        db.query(ExamAttempt)
        .filter(ExamAttempt.exam_id == exam_id, ExamAttempt.submitted_at.isnot(None))
        .all()
    )
    total = len(attempts)
    questions = db.query(Question).filter(Question.exam_id == exam_id).all()

    answers_by_question: dict[uuid.UUID, list[QuestionAttempt]] = {q.id: [] for q in questions}
    if attempts:
        rows = (
            db.query(QuestionAttempt)
            .filter(QuestionAttempt.exam_attempt_id.in_([a.id for a in attempts]))
            .all()
        )
        for row in rows:
            answers_by_question.setdefault(row.question_id, []).append(row)

    def label_for(q: Question, answer: str) -> str | None:
        if isinstance(q.choices, dict):
            for key, text in q.choices.items():
                if key.strip().lower() == answer.strip().lower():
                    return text
        return None

    per_question: list[QuestionAnalytics] = []
    for q in questions:
        rows = answers_by_question.get(q.id, [])
        correct = sum(1 for r in rows if r.is_correct)
        counts: dict[str, int] = {}
        for r in rows:
            key = r.submitted_answer.strip()
            counts[key] = counts.get(key, 0) + 1
        wrong = [(k, c) for k, c in counts.items() if k.lower() != q.correct_answer.strip().lower()]
        wrong.sort(key=lambda kc: -kc[1])
        choice_counts: list[ChoiceCount] = []
        if isinstance(q.choices, dict):
            lowered = {k.lower(): c for k, c in counts.items()}
            choice_counts = [ChoiceCount(answer=k, label=v, count=lowered.get(k.lower(), 0)) for k, v in q.choices.items()]
        per_question.append(
            QuestionAnalytics(
                question_id=q.id,
                prompt=q.prompt,
                question_type=q.question_type,
                correct_answer=q.correct_answer,
                correct_answer_label=label_for(q, q.correct_answer),
                correct_count=correct,
                answered_count=len(rows),
                correct_rate=(correct / total) if total else 0.0,
                most_common_wrong=ChoiceCount(answer=wrong[0][0], label=label_for(q, wrong[0][0]), count=wrong[0][1]) if wrong else None,
                choice_counts=choice_counts,
            )
        )
    per_question.sort(key=lambda qa: (qa.correct_rate, -qa.answered_count))

    durations = [a.duration_seconds for a in attempts if a.duration_seconds is not None]
    return ExamAnalyticsOut(
        exam_id=exam.id,
        exam_title=exam.title,
        passing_percent=exam.passing_percent,
        attempt_count=total,
        student_count=len({a.user_id for a in attempts}),
        pass_rate=(sum(1 for a in attempts if a.passed) / total) if total else None,
        average_score=(sum(a.score_percent or 0 for a in attempts) / total) if total else None,
        average_duration_seconds=(sum(durations) / len(durations)) if durations else None,
        questions=per_question,
    )


@router.delete("/{exam_id}", status_code=204)
def delete_exam(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_course(db, current_user, exam.course_id)
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

    in_progress = _in_progress_attempt(db, exam, current_user.id)
    best = _best_attempt(db, exam_id, current_user.id)
    block, next_at, submitted = _start_block(db, exam, current_user.id)
    used = len(submitted)
    return ExamStatusOut(
        passed=best is not None,
        best_score_percent=best.score_percent if best else None,
        in_progress_attempt_id=in_progress.id if in_progress else None,
        in_progress_started_at=in_progress.started_at if in_progress else None,
        question_count=_question_count(db, exam_id),
        time_limit_minutes=exam.time_limit_minutes,
        max_attempts=exam.max_attempts,
        attempts_used=used,
        attempts_remaining=max(0, exam.max_attempts - used) if exam.max_attempts else None,
        # Resuming an attempt that's already open is always allowed.
        can_start=in_progress is not None or block is None,
        blocked_reason=None if in_progress is not None else block,
        next_attempt_at=next_at,
        server_now=_now(),
        history=[
            ExamHistoryRow(
                attempt_id=a.id,
                score_percent=a.score_percent,
                passed=a.passed,
                duration_seconds=a.duration_seconds,
                submitted_at=a.submitted_at,
                auto_submitted=a.auto_submitted,
                pending_review=a.pending_review,
            )
            for a in submitted
        ],
    )


def _ordered_questions(attempt: ExamAttempt, questions: list[Question]) -> list[Question]:
    """Questions in this attempt's stored order; any question added to the
    exam after the attempt started goes at the end, deleted ones drop out."""
    position = {qid: i for i, qid in enumerate(attempt.question_order or [])}
    return sorted(questions, key=lambda q: (position.get(str(q.id), len(position)), str(q.id)))


def _student_question(attempt: ExamAttempt, question: Question) -> ExamQuestionForStudent:
    out = ExamQuestionForStudent.model_validate(question)
    out.points = question.points or 1
    if isinstance(question.choices, dict):
        stored = (attempt.choice_orders or {}).get(str(question.id))
        keys = list(question.choices.keys())
        if stored:
            # Keep only keys that still exist, append any added since.
            order = [k for k in stored if k in question.choices] + [k for k in keys if k not in stored]
        else:
            order = keys
        out.choice_order = order
    return out


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

    # Resume an open attempt rather than starting a second one in parallel,
    # so a dropped connection or force-close can't be used to reset the
    # clock. An open attempt whose time ran out is graded and closed here.
    attempt = _in_progress_attempt(db, exam, current_user.id)
    if attempt is None:
        block, next_at, _ = _start_block(db, exam, current_user.id)
        if block == "max_attempts":
            raise HTTPException(status_code=403, detail="max_attempts")
        if block == "cooldown":
            raise HTTPException(status_code=403, detail="cooldown")

        question_ids = [str(q.id) for q in questions]
        if exam.shuffle_questions:
            random.shuffle(question_ids)
        choice_orders: dict[str, list[str]] = {}
        if exam.shuffle_choices:
            for q in questions:
                if isinstance(q.choices, dict) and q.choices:
                    keys = list(q.choices.keys())
                    random.shuffle(keys)
                    choice_orders[str(q.id)] = keys

        attempt = ExamAttempt(
            exam_id=exam_id,
            user_id=current_user.id,
            question_order=question_ids,
            choice_orders=choice_orders or None,
        )
        db.add(attempt)
        db.commit()
        db.refresh(attempt)

    activity.record_activity(db, current_user.id)
    db.commit()
    deadline = _deadline(attempt, exam)
    return ExamStartOut(
        attempt_id=attempt.id,
        started_at=attempt.started_at,
        passing_percent=exam.passing_percent,
        questions=[_student_question(attempt, q) for q in _ordered_questions(attempt, questions)],
        time_limit_seconds=exam.time_limit_minutes * 60 if exam.time_limit_minutes else None,
        expires_at=deadline,
        server_now=_now(),
        saved_answers=attempt.draft_answers or {},
        flagged_question_ids=attempt.flagged_questions or [],
        saved_answer_images={
            qid: url
            for qid, value in (attempt.draft_answers or {}).items()
            if (url := _answer_image_url(attempt, value))
        },
    )


def _own_open_attempt(db: Session, attempt_id: uuid.UUID, user: User) -> tuple[ExamAttempt, Exam]:
    attempt = db.get(ExamAttempt, attempt_id)
    if not attempt or attempt.user_id != user.id:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.submitted_at is not None:
        raise HTTPException(status_code=409, detail="This attempt was already submitted.")
    exam = db.get(Exam, attempt.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    return attempt, exam


@router.put("/attempts/{attempt_id}/draft", status_code=204)
def save_exam_draft(
    attempt_id: uuid.UUID,
    payload: ExamDraftIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Autosave of the student's current answers and flags. Once the time
    limit has run out the attempt is graded from the last saved draft and
    this returns 409 "time_up"."""
    attempt, exam = _own_open_attempt(db, attempt_id, current_user)
    if _is_expired(attempt, exam):
        _finalize_attempt(db, attempt, exam, attempt.draft_answers or {}, auto=True)
        raise HTTPException(status_code=409, detail="time_up")
    attempt.draft_answers = {k: v for k, v in payload.answers.items() if v is not None}
    attempt.flagged_questions = list(dict.fromkeys(payload.flagged_question_ids))
    db.commit()


@router.post("/attempts/{attempt_id}/submit", response_model=ExamSubmitResult)
def submit_exam(
    attempt_id: uuid.UUID,
    payload: ExamSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExamSubmitResult:
    attempt, exam = _own_open_attempt(db, attempt_id, current_user)
    if _is_expired(attempt, exam):
        # Too late for these answers to count — grade what was autosaved
        # before the deadline instead.
        return _finalize_attempt(db, attempt, exam, attempt.draft_answers or {}, auto=True)
    answers = {str(a.question_id): a.submitted_answer for a in payload.answers}
    activity.record_activity(db, current_user.id)
    return _finalize_attempt(db, attempt, exam, answers, auto=False)


@router.get("/attempts/{attempt_id}/result", response_model=ExamSubmitResult)
def get_attempt_result(
    attempt_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExamSubmitResult:
    """A student's own past attempt — e.g. to see the final score once the
    teacher has graded their essay answers."""
    attempt = db.get(ExamAttempt, attempt_id)
    if not attempt or attempt.user_id != current_user.id or attempt.submitted_at is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    exam = db.get(Exam, attempt.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    return _build_result(db, attempt, exam)


# --- Teacher: grading essay answers ------------------------------------------


@router.get("/{exam_id}/reviews", response_model=list[ReviewItem])
def list_reviews(
    exam_id: uuid.UUID,
    status: str = "pending",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> list[ReviewItem]:
    """Essay answers for this exam: status=pending (default, oldest first)
    or status=reviewed (most recently graded first)."""
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_course(db, current_user, exam.course_id)

    query = (
        db.query(QuestionAttempt, ExamAttempt, Question, User)
        .join(ExamAttempt, ExamAttempt.id == QuestionAttempt.exam_attempt_id)
        .join(Question, Question.id == QuestionAttempt.question_id)
        .join(User, User.id == QuestionAttempt.user_id)
        .filter(ExamAttempt.exam_id == exam_id, Question.question_type == ESSAY)
    )
    if status == "reviewed":
        query = query.filter(QuestionAttempt.needs_review.is_(False)).order_by(QuestionAttempt.reviewed_at.desc())
    else:
        query = query.filter(QuestionAttempt.needs_review.is_(True)).order_by(ExamAttempt.submitted_at.asc())

    return [
        ReviewItem(
            question_attempt_id=qa.id,
            attempt_id=attempt.id,
            student_name=user.full_name_ar or user.full_name,
            student_email=user.email,
            question_id=question.id,
            prompt=question.prompt,
            image_url=question.image_url,
            model_answer=question.correct_answer or None,
            max_points=question.points or 1,
            submitted_answer=qa.submitted_answer,
            answer_image_url=_answer_image_url(attempt, qa.submitted_answer),
            submitted_at=attempt.submitted_at,
            points_awarded=qa.points_awarded,
            teacher_comment=qa.teacher_comment,
            reviewed_at=qa.reviewed_at,
        )
        for qa, attempt, question, user in query.limit(500).all()
    ]


@router.post("/answers/{question_attempt_id}/review", response_model=ReviewResult)
def review_answer(
    question_attempt_id: uuid.UUID,
    payload: ReviewIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> ReviewResult:
    """Grade (or re-grade) one essay answer with 0..max points. When it was
    the attempt's last ungraded essay, the attempt gets its final score —
    which can also unlock lessons gated by this exam."""
    qa = db.get(QuestionAttempt, question_attempt_id)
    if not qa or qa.exam_attempt_id is None:
        raise HTTPException(status_code=404, detail="Answer not found")
    attempt = db.get(ExamAttempt, qa.exam_attempt_id)
    exam = db.get(Exam, attempt.exam_id) if attempt else None
    question = db.get(Question, qa.question_id)
    if not attempt or not exam or not question:
        raise HTTPException(status_code=404, detail="Answer not found")
    ensure_can_manage_course(db, current_user, exam.course_id)
    if question.question_type != ESSAY:
        raise HTTPException(status_code=400, detail="Only essay answers are graded by hand.")
    max_points = float(question.points or 1)
    if payload.points_awarded > max_points:
        raise HTTPException(status_code=400, detail=f"This question is worth at most {question.points or 1} point(s).")

    qa.points_awarded = payload.points_awarded
    qa.is_correct = payload.points_awarded >= max_points
    qa.needs_review = False
    qa.reviewed_at = _now()
    qa.reviewed_by_user_id = current_user.id
    qa.teacher_comment = (payload.comment or "").strip() or None
    db.flush()

    was_pending = attempt.pending_review
    _recompute_attempt(db, attempt, exam)
    db.commit()
    return ReviewResult(
        question_attempt_id=qa.id,
        points_awarded=qa.points_awarded,
        attempt_finalized=was_pending and not attempt.pending_review,
        attempt_score_percent=attempt.score_percent,
        attempt_passed=None if attempt.pending_review else attempt.passed,
    )


@router.post("/attempts/{attempt_id}/answer-photo", response_model=AnswerPhotoUploadOut)
def create_answer_photo_upload(
    attempt_id: uuid.UUID,
    payload: AnswerPhotoUploadIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnswerPhotoUploadOut:
    """Upload link for a photo of a handwritten solution to one essay
    question, on the student's own still-open attempt. The resulting
    file_url is only accepted as an answer on this same attempt."""
    attempt, exam = _own_open_attempt(db, attempt_id, current_user)
    if _is_expired(attempt, exam):
        _finalize_attempt(db, attempt, exam, attempt.draft_answers or {}, auto=True)
        raise HTTPException(status_code=409, detail="time_up")
    question = db.get(Question, payload.question_id)
    if not question or question.exam_id != exam.id or question.question_type != ESSAY:
        raise HTTPException(status_code=400, detail="Photos can only answer this exam's essay questions.")

    ext = Path(payload.file_name).suffix.lower() or ".jpg"
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Send the photo as JPG, PNG or WEBP.")
    if not b2_storage.b2_configured():
        raise HTTPException(status_code=503, detail="Photo storage is not configured on this server.")

    key = f"{b2_storage.ANSWER_KEY_PREFIX}{attempt.id}/{question.id}-{uuid.uuid4().hex}{ext}"
    content_type = IMAGE_EXTENSIONS[ext]
    try:
        upload_url = b2_storage.generate_upload_url(key, content_type)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not prepare upload: {e}") from e
    return AnswerPhotoUploadOut(upload_url=upload_url, content_type=content_type, file_url=f"{b2_storage.B2_URL_SCHEME}{key}")

