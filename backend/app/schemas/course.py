import uuid
from typing import Literal

from pydantic import BaseModel

# The fixed, final set of grade levels a chapter can be filed under —
# confirmed with the user as exactly these 4 Arabic strings, no others.
# Kept as a plain nullable String column at the DB layer (see
# app/models/course.py) and enforced here instead, so adding/renaming a
# grade later is a one-line change, not an ALTER TYPE migration.
GradeLevel = Literal[
    "الصف الأول الثانوي",
    "الصف الثاني الثانوي - بكالوريا",
    "الصف الثاني الثانوي - عام",
    "الصف الثالث الثانوي - عام",
]


class LessonOut(BaseModel):
    id: uuid.UUID
    title: str
    video_url: str | None = None
    order_index: int
    # True when this lesson has no segment quizzes, or the current user has
    # passed every one of them (>=75% correct on their latest attempts) —
    # computed per-request in app/api/routes/courses.py's get_course, since
    # it depends on who's asking. Defaults to True so any endpoint that
    # returns a LessonOut without computing this (e.g. a plain lesson fetch)
    # never accidentally locks something.
    quiz_passed: bool = True
    # NULL = unlimited (the default) — see app/models/lesson.py's max_views
    # comment. Exposed on every LessonOut (harmless to show; it's just a
    # setting, not a secret) so the admin lecture-edit form can prefill it.
    max_views: int | None = None
    # True once at least one LessonAccessCode has been generated for this
    # lecture (see app/models/lesson_access_code.py) — independent of
    # max_views/quiz_passed. False (the default) for every lecture that
    # never opted into the code-gate feature, so nothing changes for
    # existing content. Only ever computed for a signed-in STUDENT — see
    # app/api/routes/courses.py's _annotate_code_gate and
    # app/api/routes/lessons.py's get_lesson (instructors/admins are never
    # gated, same policy as max_views).
    requires_code: bool = False
    # Meaningless when requires_code is False. True once current_user has
    # redeemed ANY code for this specific lecture — a lecture that requires
    # a code but isn't unlocked yet has no video_url handed back (same
    # "withhold the URL server-side" approach as view_limit_reached below),
    # so the mobile app can tell "show a redeem-code prompt" apart from
    # "show the player" without a second round trip.
    code_unlocked: bool = True
    # True once current_user (a student) is blocked from this lecture by
    # one or more unpassed standalone exams earlier in the same course —
    # see app/services/exam_gate.py. Always False for instructors/admins,
    # and for any lesson with exempt_from_exam_gate=True. video_url is
    # withheld server-side whenever this is True (see
    # app/api/routes/lessons.py's get_lesson), same withholding approach as
    # view_limit_reached/code_unlocked above.
    locked_by_exam: bool = False
    # Admin-only escape hatch — lets a specific lecture stay reachable even
    # though an earlier standalone exam in the same course hasn't been
    # passed yet. Surfaced on every LessonOut (harmless, just a setting) so
    # the admin lecture-edit form can prefill its toggle.
    exempt_from_exam_gate: bool = False

    model_config = {"from_attributes": True}


class LessonDetailOut(LessonOut):
    content: str | None = None
    # The next three are only ever computed for a signed-in STUDENT on a
    # max_views-capped lesson — see app/api/routes/lessons.py's get_lesson.
    # They stay None/False for instructors/admins (never capped) and for
    # uncapped lessons, so the mobile app can tell "not applicable" apart
    # from "0 views left" (views_allowed would be a real number in that case).
    views_used: int | None = None
    views_allowed: int | None = None
    view_limit_reached: bool = False


class LessonCreate(BaseModel):
    course_id: uuid.UUID
    title: str
    content: str | None = None
    video_url: str | None = None
    order_index: int = 0
    max_views: int | None = None
    exempt_from_exam_gate: bool = False


class LessonUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    video_url: str | None = None
    order_index: int | None = None
    max_views: int | None = None
    exempt_from_exam_gate: bool | None = None


class ExamSummaryOut(BaseModel):
    """The chapter/lecture LIST view's summary of one standalone exam —
    enough for the mobile app to render an exam "card" interleaved with
    lessons (by order_index) and a start/result button. Full
    question-by-question management goes through /api/v1/exams and
    /api/v1/exams/{id}/questions/admin instead (see app/schemas/exam.py)."""

    id: uuid.UUID
    title: str
    order_index: int
    passing_percent: int
    question_count: int = 0
    # Only ever computed for a signed-in STUDENT (see
    # app/api/routes/courses.py's _annotate_exam_gate) — None for
    # instructors/admins and for a student who hasn't attempted it yet.
    passed: bool | None = None
    best_score_percent: float | None = None

    model_config = {"from_attributes": True}


class CourseOut(BaseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    title: str
    description: str | None = None
    grade_level: str | None = None
    teacher_id: uuid.UUID | None = None
    cover_image_url: str | None = None
    order_index: int

    model_config = {"from_attributes": True}


class CourseDetailOut(CourseOut):
    lessons: list[LessonOut] = []
    # Empty for the common case (a course with no standalone exams) —
    # populated by app/api/routes/courses.py's _annotate_exam_gate.
    exams: list[ExamSummaryOut] = []


class CourseCreate(BaseModel):
    subject_id: uuid.UUID
    title: str
    description: str | None = None
    grade_level: GradeLevel | None = None
    teacher_id: uuid.UUID | None = None
    cover_image_url: str | None = None
    order_index: int = 0


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    grade_level: GradeLevel | None = None
    teacher_id: uuid.UUID | None = None
    cover_image_url: str | None = None
    order_index: int | None = None
