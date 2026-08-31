"""Segment quiz questions — see app/models/question.py's pause_at_seconds
for how questions are grouped into a lecture's "parts", and
app/api/routes/courses.py for how a lesson's pass/fail on these gates
whether the app lets a student move on to the next lecture.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.question import Question, QuestionAttempt
from app.models.user import User
from app.schemas.question import (
    QuestionAdminOut,
    QuestionAttemptCreate,
    QuestionAttemptOut,
    QuestionAttemptResult,
    QuestionCreate,
    QuestionOut,
    QuestionUpdate,
)

router = APIRouter(tags=["questions"])


def _grade(question: Question, submitted_answer: str) -> bool:
    # Case/whitespace-insensitive exact match — good enough for the
    # multiple_choice/numeric/short free_response answers these are seeded
    # with; nothing here claims to do free-text semantic grading.
    return submitted_answer.strip().lower() == question.correct_answer.strip().lower()


def _subject_id_of_lesson(db: Session, lesson: Lesson) -> uuid.UUID:
    course = db.get(Course, lesson.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course.subject_id


def _ordered_questions(db: Session, lesson_id: uuid.UUID) -> list[Question]:
    # NULLs (the "no specific pause point" / end-of-video part) sort last,
    # matching how the mobile app treats them as the final segment.
    return (
        db.query(Question)
        .filter(Question.lesson_id == lesson_id)
        .order_by(Question.pause_at_seconds.is_(None), Question.pause_at_seconds, Question.id)
        .all()
    )


@router.get("/api/v1/lessons/{lesson_id}/questions", response_model=list[QuestionOut])
def list_lesson_questions(
    lesson_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[QuestionOut]:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    questions = _ordered_questions(db, lesson_id)
    latest_by_question: dict[uuid.UUID, QuestionAttempt] = {}
    if questions:
        attempts = (
            db.query(QuestionAttempt)
            .filter(
                QuestionAttempt.user_id == current_user.id,
                QuestionAttempt.question_id.in_([q.id for q in questions]),
            )
            .order_by(QuestionAttempt.created_at)
            .all()
        )
        for attempt in attempts:
            # Ascending order, so the last one written per question is the
            # most recent — exactly what a retry after a failed segment
            # should count for gating.
            latest_by_question[attempt.question_id] = attempt

    result = []
    for q in questions:
        out = QuestionOut.model_validate(q)
        latest = latest_by_question.get(q.id)
        if latest is not None:
            out.your_attempt = QuestionAttemptOut.model_validate(latest)
        result.append(out)
    return result


@router.post("/api/v1/questions/{question_id}/attempts", response_model=QuestionAttemptResult)
def submit_question_attempt(
    question_id: uuid.UUID,
    payload: QuestionAttemptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> QuestionAttemptResult:
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    is_correct = _grade(question, payload.submitted_answer)
    db.add(
        QuestionAttempt(
            user_id=current_user.id,
            question_id=question.id,
            submitted_answer=payload.submitted_answer,
            is_correct=is_correct,
        )
    )
    db.commit()
    return QuestionAttemptResult(
        is_correct=is_correct,
        correct_answer=question.correct_answer,
        explanation=question.explanation,
    )


# --- Instructor/admin: authoring -------------------------------------------


@router.get("/api/v1/lessons/{lesson_id}/questions/admin", response_model=list[QuestionAdminOut])
def list_lesson_questions_admin(
    lesson_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> list[Question]:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))
    return _ordered_questions(db, lesson_id)


@router.post("/api/v1/questions", response_model=QuestionAdminOut, status_code=201)
def create_question(
    payload: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Question:
    lesson = db.get(Lesson, payload.lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))

    question = Question(
        lesson_id=payload.lesson_id,
        prompt=payload.prompt,
        question_type=payload.question_type,
        choices=payload.choices,
        correct_answer=payload.correct_answer,
        explanation=payload.explanation,
        pause_at_seconds=payload.pause_at_seconds,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.put("/api/v1/questions/{question_id}", response_model=QuestionAdminOut)
def update_question(
    question_id: uuid.UUID,
    payload: QuestionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Question:
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    lesson = db.get(Lesson, question.lesson_id)
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/api/v1/questions/{question_id}", status_code=204)
def delete_question(
    question_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    lesson = db.get(Lesson, question.lesson_id)
    ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))
    db.delete(question)
    db.commit()
