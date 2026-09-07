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
