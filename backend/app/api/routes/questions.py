"""Segment quiz questions AND standalone-exam questions — both live in the
same Question table (see app/models/question.py's docstring on
lesson_id/exam_id being mutually exclusive). Segment quizzes: see
app/models/question.py's pause_at_seconds for how questions are grouped
into a lecture's "parts", and app/api/routes/courses.py for how a lesson's
pass/fail on these gates whether the app lets a student move on to the
next lecture. Standalone exams: see app/models/exam.py and
app/api/routes/exams.py for the take/submit flow — this file only handles
AUTHORING (create/update/delete/list) for exam questions, reusing the same
endpoints as segment-quiz questions.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.exam import Exam
from app.models.lesson import Lesson
from app.models.question import Question, QuestionAttempt
from app.models.user import User
from app.services import b2_storage
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


def _subject_id_of_exam(db: Session, exam: Exam) -> uuid.UUID:
    course = db.get(Course, exam.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course.subject_id


def _subject_id_of_question(db: Session, question: Question) -> uuid.UUID:
    """Works for either kind of question — see Question's docstring on
    lesson_id/exam_id being mutually exclusive."""
    if question.lesson_id is not None:
        lesson = db.get(Lesson, question.lesson_id)
        if not lesson:
            raise HTTPException(status_code=404, detail="Lesson not found")
        return _subject_id_of_lesson(db, lesson)
    if question.exam_id is not None:
        exam = db.get(Exam, question.exam_id)
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        return _subject_id_of_exam(db, exam)
    raise HTTPException(status_code=400, detail="This question has neither a lesson nor an exam.")


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


@router.get("/api/v1/exams/{exam_id}/questions/admin", response_model=list[QuestionAdminOut])
def list_exam_questions_admin(
    exam_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> list[Question]:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    ensure_can_manage_subject(db, current_user, _subject_id_of_exam(db, exam))
    return db.query(Question).filter(Question.exam_id == exam_id).order_by(Question.id).all()


@router.post("/api/v1/questions", response_model=QuestionAdminOut, status_code=201)
def create_question(
    payload: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Question:
    if bool(payload.lesson_id) == bool(payload.exam_id):
        raise HTTPException(status_code=400, detail="Set exactly one of lesson_id or exam_id.")

    if payload.lesson_id:
        lesson = db.get(Lesson, payload.lesson_id)
        if not lesson:
            raise HTTPException(status_code=404, detail="Lesson not found")
        ensure_can_manage_subject(db, current_user, _subject_id_of_lesson(db, lesson))
    else:
        exam = db.get(Exam, payload.exam_id)
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        ensure_can_manage_subject(db, current_user, _subject_id_of_exam(db, exam))

    question = Question(
        lesson_id=payload.lesson_id,
        exam_id=payload.exam_id,
        prompt=payload.prompt,
        question_type=payload.question_type,
        choices=payload.choices,
        correct_answer=payload.correct_answer,
        explanation=payload.explanation,
        pause_at_seconds=payload.pause_at_seconds,
        image_url=payload.image_url,
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
    ensure_can_manage_subject(db, current_user, _subject_id_of_question(db, question))

    fields = payload.model_dump(exclude_unset=True)
    # Captured before the field is overwritten below — this is the image
    # that's about to be replaced (or cleared), if any. Only actually stale
    # (and worth deleting from R2) once the new value is different AND the
    # commit below succeeds; see the cleanup call after db.commit() —
    # mirrors lessons.py's update_lesson video_url handling.
    old_image_url = question.image_url if "image_url" in fields else None

    for field, value in fields.items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)

    if old_image_url is not None and old_image_url != question.image_url:
        b2_storage.delete_object_for_url(old_image_url)

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
    ensure_can_manage_subject(db, current_user, _subject_id_of_question(db, question))
    image_url = question.image_url
    db.delete(question)
    db.commit()
    b2_storage.delete_object_for_url(image_url)
