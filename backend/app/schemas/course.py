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
    # Same b2:<key> / http(s):// / /media/... convention as Course.cover_image_url
    # — lets the chapter screen render lectures as poster cards the same way
    # the subject screen renders chapters. None = show a placeholder tile.
    cover_image_url: str | None = None
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
    # TeacherProfile.id of the teacher who owns this lesson's course — used by
    # the mobile lesson screen to call the enrollment check without a separate
    # lookup. None when the course has no teacher card assigned.
    teacher_id: uuid.UUID | None = None
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
    cover_image_url: str | None = None
    order_index: int = 0
    max_views: int | None = None
    exempt_from_exam_gate: bool = False


class LessonUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    video_url: str | None = None
    cover_image_url: str | None = None
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


class ManagedCourseOut(CourseOut):
    """One chapter in the current user's "chapters you manage" list — see
    GET /api/v1/courses/mine/managed. Just CourseOut plus the parent
    subject's name, since that list is flat (no subject-picking step) and
    needs to show which subject each chapter belongs to."""

    subject_name: str


class DashboardChapterOut(BaseModel):
    """One chapter's row in the Teacher Dashboard's per-chapter performance
    list — see GET /api/v1/courses/mine/dashboard. avg_score_percent/
    exam_attempt_count are None/0 for a chapter with no completed exam
    attempts yet (no standalone exams, or nobody's finished one), so the
    mobile screen can tell "no data yet" apart from "0%"."""

    id: uuid.UUID
    title: str
    lecture_count: int
    exam_attempt_count: int = 0
    avg_score_percent: float | None = None


class VideoActivityOut(BaseModel):
    """Real watch-activity rollup for the Teacher Dashboard's "نشاط المشاهدة"
    section — built entirely from LessonProgress.completion_percent, which
    the mobile app already reports on every ~10-point step of playback (see
    PUT /api/v1/progress, called from app/lessons/[id].tsx's onVideoProgress
    — monotonic, so it only ever tracks the furthest point a student
    actually reached). Nothing here is mocked, and there's no separate
    skip-tracking column: "watched vs skipped" is read straight off how far
    each completion_percent value got. See TeacherDashboardOut.video_activity
    for when this is None entirely (nobody has watched anything yet)."""

    watched_lessons_count: int
    total_views: int
    avg_completion_percent: float
    completed_views_count: int
    low_completion_views_count: int


class VideoSkipFlagOut(BaseModel):
    """One (student, lecture) pair worth a teacher's attention — the
    student's LessonProgress.skip_count/skipped_seconds on this lecture
    crossed the dashboard's flagging bar (see my_dashboard's
    MIN_SKIP_COUNT_TO_FLAG). Sorted by skipped_seconds descending and
    capped to the worst few across every managed chapter — this is a nudge
    list, not a full audit log."""

    user_id: uuid.UUID
    full_name: str | None
    email: str
    lesson_title: str
    course_title: str
    skip_count: int
    skipped_seconds: int


class ExamSpeedFlagOut(BaseModel):
    """One suspiciously fast completed exam attempt worth a teacher's
    attention — same is_fast rule as ExamAttemptRow
    (app/schemas/exam.py/app/api/routes/exams.py's
    FAST_ATTEMPT_SECONDS_PER_QUESTION), rolled up across every chapter this
    teacher manages instead of one exam at a time. Sorted by
    seconds_per_question ascending (fastest first) and capped to the
    worst few — a nudge list, not a full audit log."""

    user_id: uuid.UUID
    full_name: str | None
    email: str
    exam_title: str
    course_title: str
    score_percent: float | None
    duration_seconds: int
    question_count: int
    seconds_per_question: float


class TeacherDashboardOut(BaseModel):
    """Aggregated stats backing the Teacher Dashboard screen — same chapter
    scoping as GET /api/v1/courses/mine/managed (every chapter for an admin,
    only the chapter(s) filed under the caller's linked teacher card for an
    instructor), rolled up into counts + exam performance instead of a flat
    list. avg_score_percent/pass_rate_percent are None (not 0) when nobody
    has completed a standalone exam yet in any managed chapter."""

    chapters_count: int
    lectures_count: int
    avg_score_percent: float | None = None
    pass_rate_percent: float | None = None
    chapters: list[DashboardChapterOut] = []
    # None when no student has recorded any watch progress yet in any
    # managed chapter — lets the mobile screen show a real "no data yet"
    # state instead of a misleading 0%.
    video_activity: VideoActivityOut | None = None
    # Both empty (never null) when nothing has crossed the flagging bar yet
    # — see my_dashboard for how each is computed.
    video_skip_flags: list[VideoSkipFlagOut] = []
    exam_speed_flags: list[ExamSpeedFlagOut] = []


class StudentReportRow(BaseModel):
    """One student's row in a chapter's student-activity report — see GET
    /api/v1/courses/{course_id}/student-report. This platform has no fixed
    class roster/enrollment (any student can open any chapter), so "the
    students of this chapter" is inferred from real activity: everyone who
    has EITHER opened at least one of its lectures OR attempted one of its
    exams. watched_lessons_count counts a lecture as "watched" the moment a
    LessonProgress row exists for it (i.e. the student opened it at all —
    not a completion-percent threshold), so a teacher can tell "never
    opened" apart from "opened but didn't finish"."""

    user_id: uuid.UUID
    full_name: str | None
    email: str
    watched_lessons_count: int
    missing_lesson_titles: list[str]
    attempted_exams_count: int
    missing_exam_titles: list[str]
    # Summed across every lecture of THIS chapter only (unlike the
    # dashboard's video_skip_flags, which is cross-chapter) — see
    # LessonProgress.skip_count/skipped_seconds. 0 for a student with no
    # detected skips in this chapter.
    skip_count: int = 0
    skipped_seconds: int = 0


class CourseStudentReportOut(BaseModel):
    """Backs the Teacher Dashboard's per-chapter "who hasn't watched / who
    hasn't taken the exam" report screen. lectures_count/exams_count are the
    chapter's totals (for computing each row's X/Y), students is every
    student who has touched this chapter at all, sorted by
    CourseStudentReportOut so the ones with the most gaps float to the top."""

    course_id: uuid.UUID
    course_title: str
    lectures_count: int
    exams_count: int
    students: list[StudentReportRow] = []


class CourseCreate(BaseModel):
    # Nullable because an instructor creating their own chapter never sends
    # one — the server derives it from their linked TeacherProfile instead
    # (see app/api/routes/courses.py's create_course). Still required in
    # practice for an admin's request; enforced there, not by this schema,
    # since which rule applies depends on the caller's role.
    subject_id: uuid.UUID | None = None
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
