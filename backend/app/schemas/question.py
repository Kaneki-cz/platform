import uuid

from pydantic import BaseModel


class QuestionAttemptOut(BaseModel):
    """The current student's most recent attempt at one question — embedded
    into QuestionOut so the app can show "already answered" state and work
    out whether a segment's quiz has been passed without a second
    round-trip. Deliberately omits submitted_answer/created_at — the app
    only needs correctness here."""

    is_correct: bool

    model_config = {"from_attributes": True}


class QuestionOut(BaseModel):
    """What a student sees before answering — never includes
    correct_answer/explanation (see QuestionAdminOut for the instructor's
    view, and QuestionAttemptResult for what's revealed after a submission).

    Belongs to EXACTLY ONE of lesson_id (an in-video segment quiz question)
    or exam_id (a standalone-exam question, see app/models/exam.py) — both
    are optional here for that reason. The standalone-exam TAKING flow uses
    its own leaner app/schemas/exam.py:ExamQuestionForStudent instead of
    this one (exam questions are answered all at once, not one at a time
    with immediate per-question feedback like segment quizzes)."""

    id: uuid.UUID
    lesson_id: uuid.UUID | None = None
    exam_id: uuid.UUID | None = None
    prompt: str
    question_type: str
    choices: dict | list | None = None
    pause_at_seconds: int | None = None
    your_attempt: QuestionAttemptOut | None = None

    model_config = {"from_attributes": True}


class QuestionAdminOut(BaseModel):
    """The instructor/admin management view — includes the answer key,
    unlike QuestionOut. Used for both lesson-segment questions and
    standalone-exam questions (see QuestionOut's docstring)."""

    id: uuid.UUID
    lesson_id: uuid.UUID | None = None
    exam_id: uuid.UUID | None = None
    prompt: str
    question_type: str
    choices: dict | list | None = None
    correct_answer: str
    explanation: str | None = None
    pause_at_seconds: int | None = None

    model_config = {"from_attributes": True}


class QuestionAttemptCreate(BaseModel):
    submitted_answer: str


class QuestionAttemptResult(BaseModel):
    """Returned right after a submission — reveals the answer key for just
    this one question, now that the student has committed to an attempt."""

    is_correct: bool
    correct_answer: str
    explanation: str | None = None


class QuestionCreate(BaseModel):
    """Set exactly one of lesson_id/exam_id — enforced in
    app/api/routes/questions.py's create_question, not here, so the error
    message can name both fields explicitly."""

    lesson_id: uuid.UUID | None = None
    exam_id: uuid.UUID | None = None
    prompt: str
    question_type: str = "multiple_choice"
    choices: dict | list | None = None
    correct_answer: str
    explanation: str | None = None
    pause_at_seconds: int | None = None


class QuestionUpdate(BaseModel):
    prompt: str | None = None
    question_type: str | None = None
    choices: dict | list | None = None
    correct_answer: str | None = None
    explanation: str | None = None
    pause_at_seconds: int | None = None
