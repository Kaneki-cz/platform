import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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
    # Essay answers in this exam still waiting for a teacher's grade.
    pending_reviews: int = 0
    total_points: int = 0
    time_limit_minutes: int | None = None
    max_attempts: int | None = None
    retake_cooldown_minutes: int | None = None
    shuffle_questions: bool = True
    shuffle_choices: bool = True
    show_answers_on_fail: bool = False

    model_config = {"from_attributes": True}


class ExamCreate(BaseModel):
    course_id: uuid.UUID
    title: str
    description: str | None = None
    order_index: int = 0
    passing_percent: int = 75
    time_limit_minutes: int | None = Field(default=None, ge=1)
    max_attempts: int | None = Field(default=None, ge=1)
    retake_cooldown_minutes: int | None = Field(default=None, ge=1)
    shuffle_questions: bool = True
    shuffle_choices: bool = True
    show_answers_on_fail: bool = False


class ExamUpdate(BaseModel):
    """Partial update — only fields actually sent are applied (see
    update_exam's exclude_unset). Send null for a numeric rule to remove
    that limit."""

    title: str | None = None
    description: str | None = None
    order_index: int | None = None
    passing_percent: int | None = None
    time_limit_minutes: int | None = Field(default=None, ge=1)
    max_attempts: int | None = Field(default=None, ge=1)
    retake_cooldown_minutes: int | None = Field(default=None, ge=1)
    shuffle_questions: bool | None = None
    shuffle_choices: bool | None = None
    show_answers_on_fail: bool | None = None


class ExamQuestionForStudent(BaseModel):
    """What a student sees while taking the exam — no correct_answer, no
    explanation, same withholding policy as the segment-quiz's
    QuestionOut."""

    id: uuid.UUID
    prompt: str
    question_type: str
    choices: dict | list | None = None
    image_url: str | None = None
    points: int = 1
    # Display order for `choices` keys in THIS attempt (shuffled when the
    # exam has shuffle_choices on). JSON object key order isn't reliable on
    # every client, so the order travels as its own list.
    choice_order: list[str] | None = None

    model_config = {"from_attributes": True}


class ExamStartOut(BaseModel):
    attempt_id: uuid.UUID
    # Server-anchored — the mobile app's timer counts up/down from this,
    # never from its own clock, so force-closing the app can't pause it.
    started_at: datetime
    passing_percent: int
    # Already in this attempt's (possibly shuffled) order.
    questions: list[ExamQuestionForStudent]
    # Time limit for this attempt, if any. `server_now` lets the app correct
    # for a phone whose clock is off when computing the remaining time.
    time_limit_seconds: int | None = None
    expires_at: datetime | None = None
    server_now: datetime | None = None
    # Restored draft when resuming ({question_id: answer}, [question_id]).
    saved_answers: dict[str, str] = {}
    flagged_question_ids: list[str] = []


class ExamDraftIn(BaseModel):
    """Autosave while taking an exam — the full current state, replacing
    whatever was saved before."""

    answers: dict[str, str] = {}
    flagged_question_ids: list[str] = []


class ExamAnswerSubmit(BaseModel):
    question_id: uuid.UUID
    submitted_answer: str = Field(max_length=5000)


class ExamSubmitRequest(BaseModel):
    # May be partial — an unanswered question is simply graded wrong.
    answers: list[ExamAnswerSubmit]


class ExamAnswerResult(BaseModel):
    question_id: uuid.UUID
    is_correct: bool
    # Withheld (null) on a failed attempt unless the exam has
    # show_answers_on_fail on — see ExamSubmitResult.answers_revealed.
    correct_answer: str | None = None
    explanation: str | None = None
    question_type: str | None = None
    prompt: str | None = None
    points: int = 1
    points_awarded: float | None = None
    # Essay answers: True while waiting for the teacher.
    pending_review: bool = False
    teacher_comment: str | None = None
    submitted_answer: str | None = None


class ExamSubmitResult(BaseModel):
    attempt_id: uuid.UUID | None = None
    # None while essay answers are still waiting for the teacher.
    score_percent: float | None = None
    passed: bool
    correct_count: int
    total_count: int
    duration_seconds: int
    answers: list[ExamAnswerResult]
    answers_revealed: bool = True
    # True when the server submitted it because the time limit ran out.
    auto_submitted: bool = False
    earned_points: float | None = None
    total_points: float | None = None
    # True while essay answers wait for the teacher; score_percent is None
    # and passed False until then.
    pending_review: bool = False


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
    # --- exam rules, for the intro screen ---
    question_count: int = 0
    time_limit_minutes: int | None = None
    max_attempts: int | None = None
    attempts_used: int = 0
    attempts_remaining: int | None = None
    # False when a new attempt can't start right now; blocked_reason says
    # why ("max_attempts" | "cooldown" | "no_questions") and next_attempt_at
    # says when the cooldown ends.
    can_start: bool = True
    blocked_reason: str | None = None
    next_attempt_at: datetime | None = None
    server_now: datetime | None = None
    history: list["ExamHistoryRow"] = []


class ExamHistoryRow(BaseModel):
    """One of the student's own submitted attempts, newest first."""

    attempt_id: uuid.UUID
    score_percent: float | None
    passed: bool
    duration_seconds: int | None
    submitted_at: datetime | None
    auto_submitted: bool = False
    pending_review: bool = False


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
    pending_review: bool = False


class ExamAttemptsOut(BaseModel):
    exam_id: uuid.UUID
    exam_title: str
    question_count: int
    attempts: list[ExamAttemptRow] = []



class ReviewItem(BaseModel):
    """One essay answer for the teacher to grade."""

    # "model_answer" is a plain field, not pydantic's model_* namespace.
    model_config = {"protected_namespaces": ()}

    question_attempt_id: uuid.UUID
    attempt_id: uuid.UUID
    student_name: str | None
    student_email: str
    question_id: uuid.UUID
    prompt: str
    image_url: str | None = None
    model_answer: str | None = None
    max_points: int
    submitted_answer: str
    submitted_at: datetime | None
    points_awarded: float | None = None
    teacher_comment: str | None = None
    reviewed_at: datetime | None = None


class ReviewIn(BaseModel):
    points_awarded: float = Field(ge=0)
    comment: str | None = Field(default=None, max_length=2000)


class ReviewResult(BaseModel):
    question_attempt_id: uuid.UUID
    points_awarded: float
    # Whether this was the last essay on that attempt — the attempt now
    # has its final score.
    attempt_finalized: bool
    attempt_score_percent: float | None = None
    attempt_passed: bool | None = None


ExamStatusOut.model_rebuild()


class ChoiceCount(BaseModel):
    answer: str
    label: str | None = None
    count: int


class QuestionAnalytics(BaseModel):
    """How one question performed across every submitted attempt."""

    question_id: uuid.UUID
    prompt: str
    question_type: str
    correct_answer: str
    correct_answer_label: str | None = None
    correct_count: int
    answered_count: int
    # correct_count / every submitted attempt (an unanswered question counts
    # as wrong, same as in grading).
    correct_rate: float
    most_common_wrong: ChoiceCount | None = None
    # Multiple-choice only: how many attempts picked each option, in the
    # question's own option order.
    choice_counts: list[ChoiceCount] = []


class ExamAnalyticsOut(BaseModel):
    """Teacher-facing summary of an exam: overall results plus per-question
    difficulty, hardest question first."""

    exam_id: uuid.UUID
    exam_title: str
    passing_percent: int
    attempt_count: int
    student_count: int
    pass_rate: float | None = None
    average_score: float | None = None
    average_duration_seconds: float | None = None
    questions: list[QuestionAnalytics] = []
