import uuid
from datetime import datetime

from pydantic import BaseModel


class ExamOut(BaseModel):
    """Admin/instructor management view of one exam — its questions are
    managed separately (GET/POST/PUT/DELETE on
    /api/v1/questions, extended to accept exam_id — see
    app/api/routes/questions.py), mirroring how a lecture's segment-quiz
    questions are already managed."""

    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    description: str | None = None
    order_index: int
    passing_percent: int
    question_count: int = 0

    model_config = {"from_attributes": True}


class ExamCreate(BaseModel):
    course_id: uuid.UUID
    title: str
    description: str | None = None
    order_index: int = 0
    passing_percent: int = 75


class ExamUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    order_index: int | None = None
    passing_percent: int | None = None


class ExamQuestionForStudent(BaseModel):
    """What a student sees while taking the exam — no correct_answer, no
    explanation, same withholding policy as the segment-quiz's
    QuestionOut."""

    id: uuid.UUID
    prompt: str
    question_type: str
    choices: dict | list | None = None
    image_url: str | None = None

    model_config = {"from_attributes": True}


class ExamStartOut(BaseModel):
    attempt_id: uuid.UUID
    # Server-anchored — the mobile app's timer counts up/down from this,
    # never from its own clock, so force-closing the app can't pause it.
    started_at: datetime
    passing_percent: int
    questions: list[ExamQuestionForStudent]


class ExamAnswerSubmit(BaseModel):
    question_id: uuid.UUID
    submitted_answer: str


class ExamSubmitRequest(BaseModel):
    answers: list[ExamAnswerSubmit]


class ExamAnswerResult(BaseModel):
    question_id: uuid.UUID
    is_correct: bool
    correct_answer: str
    explanation: str | None = None


class ExamSubmitResult(BaseModel):
    score_percent: float
    passed: bool
    correct_count: int
    total_count: int
    duration_seconds: int
    answers: list[ExamAnswerResult]


class ExamStatusOut(BaseModel):
    """What a student sees before deciding to start/resume an exam —
    whether they've already passed (so the app can show a result screen
    instead of a start button), and whether an attempt is already in
    progress to resume (see ExamAttempt's one-in-progress-at-a-time rule
    in app/models/exam.py) rather than starting a fresh one."""

    passed: bool
    best_score_percent: float | None = None
    in_progress_attempt_id: uuid.UUID | None = None
    in_progress_started_at: datetime | None = None


class ExamAttemptRow(BaseModel):
    """One student's one completed sitting of an exam — the teacher-facing
    "grades" view (see GET /api/v1/exams/{exam_id}/attempts), one row per
    ExamAttempt with submitted_at set. is_fast flags an attempt whose
    average time-per-question fell below FAST_ATTEMPT_SECONDS_PER_QUESTION
    (app/api/routes/exams.py) — a nudge for the teacher to take a closer
    look, never something that blocks or penalizes the student."""

    attempt_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str | None
    email: str
    score_percent: float | None
    # Raw "X out of Y correct" — added because a bare percentage wasn't
    # enough for the teacher to see at a glance (e.g. "7/10" reads
    # differently from a plain "70%"). Computed from QuestionAttempt rows
    # tied to this attempt (see list_exam_attempts), not stored on
    # ExamAttempt itself — no migration needed. Pair with the parent
    # ExamAttemptsOut.question_count for the denominator.
    correct_count: int = 0
    passed: bool
    duration_seconds: int | None
    started_at: datetime
    submitted_at: datetime | None
    is_fast: bool = False


class ExamAttemptsOut(BaseModel):
    exam_id: uuid.UUID
    exam_title: str
    question_count: int
    attempts: list[ExamAttemptRow] = []
