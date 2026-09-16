import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ensure_can_manage_course, get_current_user, require_admin, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.exam import Exam, ExamAttempt
from app.models.lesson import Lesson
from app.models.lesson_access_code import LessonAccessCode
from app.models.progress import LessonProgress
from app.models.question import Question, QuestionAttempt
from app.models.subject import Subject
from app.models.teacher import TeacherProfile
from app.models.user import User, UserRole
from app.schemas.course import (
    CourseCreate,
    CourseDetailOut,
    CourseOut,
    CourseUpdate,
    CourseStudentReportOut,
    DashboardChapterOut,
    ExamSpeedFlagOut,
    ExamSummaryOut,
    GradesMatrixOut,
    ManagedCourseOut,
    StudentExamGradeRow,
    StudentReportRow,
    TeacherDashboardOut,
    VideoActivityOut,
    VideoSkipFlagOut,
)
from app.services import b2_storage

router = APIRouter(prefix="/api/v1/courses", tags=["courses"])

# A segment (all questions sharing one pause_at_seconds — or the whole
# lesson, for questions with no pause point) counts as passed once the
# student's latest attempt on each of its questions is correct >=75% of the
# time. Mirrors the mobile app's own client-side check in lessons/[id].tsx,
# which re-derives the same ratio as attempts come in during the visit —
# this is the version that actually gates whether the *next* lesson is
# reachable at all (see LessonOut.quiz_passed below).
PASS_THRESHOLD = 0.75

# Thresholds for the Teacher Dashboard's video-activity rollup (see
# my_dashboard below) — a view counts as "completed" once it reached this
# far, and as "low completion" (skipped most of it) below this far. Purely
# a dashboard read of LessonProgress.completion_percent; not enforced
# anywhere else.
VIDEO_COMPLETED_THRESHOLD = 90
VIDEO_LOW_COMPLETION_THRESHOLD = 50

# Cheat-detection flagging for the Teacher Dashboard (my_dashboard below) —
# both are nudge lists, never anything that blocks a student.
#
# A single forward-skip is often just a student jumping back a few seconds
# to rewatch something and overshooting on the way back, so only 2+ skips
# on the same lecture crosses the bar. Mirrors LessonProgress.skip_count
# (app/models/progress.py).
MIN_SKIP_COUNT_TO_FLAG = 2
# Same value as app/api/routes/exams.py's own FAST_ATTEMPT_SECONDS_PER_QUESTION
# — kept as a separate constant (not imported) so this route module doesn't
# depend on that one; if you change one, change both.
FAST_ATTEMPT_SECONDS_PER_QUESTION = 8
# Both flag lists are capped to this many rows — a nudge list, not a full
# audit log; the per-chapter student report is where the full picture lives.
MAX_DASHBOARD_FLAGS = 15

# "This month" for the grades-matrix's month_avg_score_percent (see
# my_grades_matrix below) is a rolling trailing window, not a calendar
# month — a student's average always covers their last 30 days of exams,
# regardless of what day of the month it is today.
MONTH_WINDOW_DAYS = 30


@router.get("", response_model=list[CourseOut])
def list_courses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[Course]:
    """Only the courses/chapters `current_user` has actually started (has a
    progress entry on at least one of their lessons) — this is what backs
    the Home tab's "Continue learning" list only (the mobile app's only
    caller of this endpoint; browsing everything else goes through
    GET /subjects/{id}, which is unaffected).

    This used to return every chapter on the whole platform, unfiltered.
    Before the teacher/grade-scoped chapters feature that was harmless —
    home just doubled as a flat course directory — but once chapters could
    be filed under a specific teacher/grade meant for a subset of students,
    that turned into a real leak: any chapter you added anywhere showed up
    on every student's home screen the moment it existed, regardless of
    which teacher/grade it was supposed to be gated behind. Scoping to
    "started" closes that until proper enrollment/paywall gating exists.
    """
    return (
        db.query(Course)
        .join(Lesson, Lesson.course_id == Course.id)
        .join(
            LessonProgress,
            (LessonProgress.lesson_id == Lesson.id) & (LessonProgress.user_id == current_user.id),
        )
        .distinct()
        .order_by(Course.order_index)
        .all()
    )


@router.get("/{course_id}", response_model=CourseDetailOut)
def get_course(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CourseDetailOut:
    course = (
        db.query(Course)
        .options(selectinload(Course.lessons))
        .filter(Course.id == course_id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    out = CourseDetailOut.model_validate(course)
    _annotate_quiz_passed(db, current_user, course, out)
    _annotate_code_gate(db, current_user, course, out)
    _annotate_exam_gate(db, current_user, course, out)
    return out


def _annotate_quiz_passed(db: Session, current_user: User, course: Course, out: CourseDetailOut) -> None:
    """Sets quiz_passed on each lesson in `out.lessons` in place — True
    unless that lesson has a segment where current_user's latest attempts
    fall short of PASS_THRESHOLD. This is what app/lessons/[id].tsx uses to
    lock a lecture until the previous one's segment quizzes are cleared."""
    lesson_ids = [lesson.id for lesson in course.lessons]
    if not lesson_ids:
        return

    questions = db.query(Question).filter(Question.lesson_id.in_(lesson_ids)).all()
    if not questions:
        return  # nothing to grade — every lesson stays at its default True

    question_ids = [q.id for q in questions]
    attempts = (
        db.query(QuestionAttempt)
        .filter(QuestionAttempt.user_id == current_user.id, QuestionAttempt.question_id.in_(question_ids))
        .order_by(QuestionAttempt.created_at)
        .all()
    )
    # Ascending order => the last one stored per question is the most
    # recent attempt, exactly like app/api/routes/questions.py's own
    # latest-attempt lookup.
    latest_by_question: dict[uuid.UUID, QuestionAttempt] = {a.question_id: a for a in attempts}

    segments: dict[tuple[uuid.UUID, int | None], list[Question]] = defaultdict(list)
    for q in questions:
        segments[(q.lesson_id, q.pause_at_seconds)].append(q)

    passed_by_lesson: dict[uuid.UUID, bool] = {}
    for (lesson_id, _segment_key), segment_questions in segments.items():
        correct = sum(
            1
            for q in segment_questions
            if (attempt := latest_by_question.get(q.id)) is not None and attempt.is_correct
        )
        segment_passed = (correct / len(segment_questions)) >= PASS_THRESHOLD
        # A lesson passes only once every one of its segments does —
        # AND-combine rather than overwrite.
        passed_by_lesson[lesson_id] = passed_by_lesson.get(lesson_id, True) and segment_passed

    for lesson_out in out.lessons:
        if lesson_out.id in passed_by_lesson:
            lesson_out.quiz_passed = passed_by_lesson[lesson_out.id]


def _annotate_code_gate(db: Session, current_user: User, course: Course, out: CourseDetailOut) -> None:
    """Sets requires_code/code_unlocked on each lesson in `out.lessons` —
    same staff-exempt, opt-in-per-lesson policy as
    app/api/routes/lessons.py's get_lesson (see that function's own
    comments); kept here too so the chapter/lecture LIST screen can show the
    right locked-by-code state without a get_lesson call per row. Only ever
    computed for students — every lesson stays at its LessonOut default
    (requires_code=False, code_unlocked=True) for instructor/admin viewers."""
    if current_user.role != UserRole.student:
        return

    lesson_ids = [lesson.id for lesson in course.lessons]
    if not lesson_ids:
        return

    codes = (
        db.query(LessonAccessCode.lesson_id, LessonAccessCode.redeemed_by_user_id)
        .filter(LessonAccessCode.lesson_id.in_(lesson_ids))
        .all()
    )
    gated_lesson_ids = {lesson_id for lesson_id, _redeemed_by in codes}
    unlocked_lesson_ids = {lesson_id for lesson_id, redeemed_by in codes if redeemed_by == current_user.id}

    for lesson_out in out.lessons:
        if lesson_out.id in gated_lesson_ids:
            lesson_out.requires_code = True
            lesson_out.code_unlocked = lesson_out.id in unlocked_lesson_ids


def _annotate_exam_gate(db: Session, current_user: User, course: Course, out: CourseDetailOut) -> None:
    """Fills out.exams with every standalone Exam in this course (with
    pass/fail computed for current_user, if they're a student), and sets
    locked_by_exam on each lesson in out.lessons that has one or more
    unpassed exams earlier in the course's ordering — unless that lesson
    opted out via exempt_from_exam_gate. Instructors/admins are never
    gated (out.exams still lists every exam for them, just without a
    passed/best_score_percent verdict) — same staff-exempt policy as
    _annotate_code_gate above."""
    exams = db.query(Exam).filter(Exam.course_id == course.id).order_by(Exam.order_index).all()

    passed_exam_ids: set[uuid.UUID] = set()
    best_score_by_exam: dict[uuid.UUID, float] = {}
    if current_user.role == UserRole.student and exams:
        rows = (
            db.query(ExamAttempt.exam_id, ExamAttempt.score_percent)
            .filter(
                ExamAttempt.user_id == current_user.id,
                ExamAttempt.exam_id.in_([e.id for e in exams]),
                ExamAttempt.passed.is_(True),
            )
            .all()
        )
        for exam_id, score in rows:
            passed_exam_ids.add(exam_id)
            best_score_by_exam[exam_id] = max(best_score_by_exam.get(exam_id, 0.0), score or 0.0)

    exam_summaries: list[ExamSummaryOut] = []
    for exam in exams:
        summary = ExamSummaryOut.model_validate(exam)
        summary.question_count = db.query(Question).filter(Question.exam_id == exam.id).count()
        if current_user.role == UserRole.student:
            summary.passed = exam.id in passed_exam_ids
            summary.best_score_percent = best_score_by_exam.get(exam.id) if exam.id in passed_exam_ids else None
        exam_summaries.append(summary)
    out.exams = exam_summaries

    if current_user.role != UserRole.student or not exams:
        return

    lessons_by_id = {lesson.id: lesson for lesson in course.lessons}
    for lesson_out in out.lessons:
        lesson = lessons_by_id.get(lesson_out.id)
        if lesson is None or lesson.exempt_from_exam_gate:
            continue
        gating = [e for e in exams if e.order_index < lesson.order_index]
        if gating and not all(e.id in passed_exam_ids for e in gating):
            lesson_out.locked_by_exam = True


@router.get("/mine/managed", response_model=list[ManagedCourseOut])
def my_managed_courses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[ManagedCourseOut]:
    """Chapters the current user can add lessons/exams to: every chapter on
    the platform for an admin, only the chapter(s) filed under their linked
    teacher card for an instructor (see app/models/teacher.py's user_id and
    app/api/deps.py's ensure_can_manage_course), none for a student. Flat —
    no subject-picking step — since an instructor is now scoped to specific
    chapters rather than a whole subject; each row carries its own
    subject_name so the mobile admin home screen can still show it."""
    query = db.query(Course, Subject.name).join(Subject, Subject.id == Course.subject_id)

    if current_user.role == UserRole.admin:
        pass
    elif current_user.role == UserRole.instructor:
        query = query.join(TeacherProfile, TeacherProfile.id == Course.teacher_id).filter(
            TeacherProfile.user_id == current_user.id
        )
    else:
        return []

    rows = query.order_by(Subject.order_index, Course.order_index).all()
    return [ManagedCourseOut(**CourseOut.model_validate(course).model_dump(), subject_name=subject_name) for course, subject_name in rows]


@router.get("/mine/dashboard", response_model=TeacherDashboardOut)
def my_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> TeacherDashboardOut:
    """Aggregated stats for the Teacher Dashboard screen — same chapter
    scoping as my_managed_courses above (every chapter for an admin, only
    the chapter(s) filed under the caller's linked teacher card for an
    instructor), rolled up into counts + exam performance instead of a flat
    list. All real numbers computed from Lesson/Exam/ExamAttempt rows —
    nothing here is mocked. Only completed attempts (submitted_at set)
    count toward the score/pass-rate numbers, same as everywhere else exam
    results are surfaced (see _annotate_exam_gate above)."""
    query = db.query(Course)
    if current_user.role == UserRole.admin:
        pass
    else:
        query = query.join(TeacherProfile, TeacherProfile.id == Course.teacher_id).filter(
            TeacherProfile.user_id == current_user.id
        )

    courses = query.order_by(Course.order_index).all()
    course_ids = [c.id for c in courses]

    lecture_counts: dict[uuid.UUID, int] = {}
    if course_ids:
        rows = (
            db.query(Lesson.course_id, func.count(Lesson.id))
            .filter(Lesson.course_id.in_(course_ids))
            .group_by(Lesson.course_id)
            .all()
        )
        lecture_counts = dict(rows)

    # One row per course with at least one completed exam attempt — a
    # course with no standalone exams, or exams nobody has finished yet,
    # simply has no entry here and falls back to (0, None, 0) below.
    exam_stats: dict[uuid.UUID, tuple[int, float | None, int]] = {}
    if course_ids:
        rows = (
            db.query(
                Exam.course_id,
                func.count(ExamAttempt.id),
                func.avg(ExamAttempt.score_percent),
                func.sum(case((ExamAttempt.passed.is_(True), 1), else_=0)),
            )
            .join(ExamAttempt, ExamAttempt.exam_id == Exam.id)
            .filter(Exam.course_id.in_(course_ids), ExamAttempt.submitted_at.isnot(None))
            .group_by(Exam.course_id)
            .all()
        )
        for course_id, attempt_count, avg_score, passed_count in rows:
            exam_stats[course_id] = (attempt_count, float(avg_score) if avg_score is not None else None, passed_count or 0)

    chapters_out: list[DashboardChapterOut] = []
    total_attempts = 0
    total_passed = 0
    # Weighted by each chapter's own attempt count, so a chapter with 300
    # attempts doesn't get diluted to the same weight as one with 3 when
    # computing the platform-wide average score.
    score_weighted_sum = 0.0
    for course in courses:
        attempt_count, avg_score, passed_count = exam_stats.get(course.id, (0, None, 0))
        chapters_out.append(
            DashboardChapterOut(
                id=course.id,
                title=course.title,
                lecture_count=lecture_counts.get(course.id, 0),
                exam_attempt_count=attempt_count,
                avg_score_percent=avg_score,
            )
        )
        if attempt_count:
            total_attempts += attempt_count
            total_passed += passed_count
            score_weighted_sum += (avg_score or 0.0) * attempt_count

    # Video-activity rollup — real numbers straight off LessonProgress rows
    # for lessons in the managed chapters (see VideoActivityOut). One row per
    # (student, lesson) pair; a lesson/course with no LessonProgress rows at
    # all (nobody's opened a video yet) simply leaves video_activity as None.
    video_activity: VideoActivityOut | None = None
    if course_ids:
        agg = (
            db.query(
                func.count(LessonProgress.id),
                func.count(func.distinct(LessonProgress.lesson_id)),
                func.avg(LessonProgress.completion_percent),
                func.sum(case((LessonProgress.completion_percent >= VIDEO_COMPLETED_THRESHOLD, 1), else_=0)),
                func.sum(case((LessonProgress.completion_percent < VIDEO_LOW_COMPLETION_THRESHOLD, 1), else_=0)),
            )
            .join(Lesson, Lesson.id == LessonProgress.lesson_id)
            .filter(Lesson.course_id.in_(course_ids))
            .first()
        )
        total_views, watched_lessons_count, avg_completion, completed_count, low_count = agg
        if total_views:
            video_activity = VideoActivityOut(
                watched_lessons_count=watched_lessons_count or 0,
                total_views=total_views,
                avg_completion_percent=float(avg_completion) if avg_completion is not None else 0.0,
                completed_views_count=completed_count or 0,
                low_completion_views_count=low_count or 0,
            )

    # Video-skip flags — students whose forward-skip count on some lecture
    # in a managed chapter crossed MIN_SKIP_COUNT_TO_FLAG. Worst
    # (skipped_seconds) first, capped to MAX_DASHBOARD_FLAGS.
    video_skip_flags: list[VideoSkipFlagOut] = []
    if course_ids:
        rows = (
            db.query(LessonProgress, Lesson.title, Course.title, User)
            .join(Lesson, Lesson.id == LessonProgress.lesson_id)
            .join(Course, Course.id == Lesson.course_id)
            .join(User, User.id == LessonProgress.user_id)
            .filter(Lesson.course_id.in_(course_ids), LessonProgress.skip_count >= MIN_SKIP_COUNT_TO_FLAG)
            .order_by(LessonProgress.skipped_seconds.desc())
            .limit(MAX_DASHBOARD_FLAGS)
            .all()
        )
        video_skip_flags = [
            VideoSkipFlagOut(
                user_id=user.id,
                full_name=user.full_name,
                email=user.email,
                lesson_title=lesson_title,
                course_title=course_title,
                skip_count=progress.skip_count,
                skipped_seconds=progress.skipped_seconds,
            )
            for progress, lesson_title, course_title, user in rows
        ]

    # Exam-speed flags — completed attempts whose average time-per-question
    # fell below FAST_ATTEMPT_SECONDS_PER_QUESTION, fastest first, capped to
    # MAX_DASHBOARD_FLAGS. Computed in Python (not SQL) since the "fast"
    # threshold depends on each exam's own question count.
    exam_speed_flags: list[ExamSpeedFlagOut] = []
    if course_ids:
        question_count_rows = (
            db.query(Question.exam_id, func.count(Question.id))
            .join(Exam, Exam.id == Question.exam_id)
            .filter(Exam.course_id.in_(course_ids))
            .group_by(Question.exam_id)
            .all()
        )
        question_counts = dict(question_count_rows)

        attempt_rows = (
            db.query(ExamAttempt, Exam.id, Exam.title, Course.title, User)
            .join(Exam, Exam.id == ExamAttempt.exam_id)
            .join(Course, Course.id == Exam.course_id)
            .join(User, User.id == ExamAttempt.user_id)
            .filter(
                Exam.course_id.in_(course_ids),
                ExamAttempt.submitted_at.isnot(None),
                ExamAttempt.duration_seconds.isnot(None),
            )
            .all()
        )
        candidates: list[ExamSpeedFlagOut] = []
        for attempt, exam_id, exam_title, course_title, user in attempt_rows:
            qcount = question_counts.get(exam_id, 0)
            if qcount <= 0:
                continue
            seconds_per_question = attempt.duration_seconds / qcount
            if seconds_per_question < FAST_ATTEMPT_SECONDS_PER_QUESTION:
                candidates.append(
                    ExamSpeedFlagOut(
                        user_id=user.id,
                        full_name=user.full_name,
                        email=user.email,
                        exam_title=exam_title,
                        course_title=course_title,
                        score_percent=attempt.score_percent,
                        duration_seconds=attempt.duration_seconds,
                        question_count=qcount,
                        seconds_per_question=round(seconds_per_question, 1),
                    )
                )
        candidates.sort(key=lambda f: f.seconds_per_question)
        exam_speed_flags = candidates[:MAX_DASHBOARD_FLAGS]

    return TeacherDashboardOut(
        chapters_count=len(courses),
        lectures_count=sum(lecture_counts.values()),
        avg_score_percent=(score_weighted_sum / total_attempts) if total_attempts else None,
        pass_rate_percent=(total_passed / total_attempts * 100) if total_attempts else None,
        chapters=chapters_out,
        video_activity=video_activity,
        video_skip_flags=video_skip_flags,
        exam_speed_flags=exam_speed_flags,
    )


@router.get("/mine/grades-matrix", response_model=GradesMatrixOut)
def my_grades_matrix(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> GradesMatrixOut:
    """Cross-chapter per-student-per-exam grades table for the Teacher
    Dashboard — one row per completed exam attempt in a chapter this
    teacher manages (same chapter scoping as my_dashboard/my_managed_courses
    above), each carrying that student's own rolling averages for context:

    - month_avg_score_percent: the student's average score across their
      completed attempts in the last MONTH_WINDOW_DAYS days, across every
      exam in every chapter this teacher manages (not just this one exam).
    - chapter_avg_score_percent: the student's average score across ALL of
      their completed attempts within this row's own chapter — all-time,
      not time-boxed, unlike the month average above.

    student_code is always None for now — a placeholder column for the
    not-yet-built per-student QR/code feature (see the project's own
    outstanding-work notes), added so the mobile table already has the
    column ready and doesn't need another schema change once codes exist.
    """
    query = db.query(Course)
    if current_user.role == UserRole.admin:
        pass
    else:
        query = query.join(TeacherProfile, TeacherProfile.id == Course.teacher_id).filter(
            TeacherProfile.user_id == current_user.id
        )
    courses = query.all()
    course_ids = [c.id for c in courses]
    course_titles = {c.id: c.title for c in courses}
    if not course_ids:
        return GradesMatrixOut(rows=[])

    question_counts = dict(
        db.query(Question.exam_id, func.count(Question.id))
        .join(Exam, Exam.id == Question.exam_id)
        .filter(Exam.course_id.in_(course_ids))
        .group_by(Question.exam_id)
        .all()
    )

    attempt_rows = (
        db.query(ExamAttempt, Exam, User)
        .join(Exam, Exam.id == ExamAttempt.exam_id)
        .join(User, User.id == ExamAttempt.user_id)
        .join(Course, Course.id == Exam.course_id)
        .filter(Exam.course_id.in_(course_ids), ExamAttempt.submitted_at.isnot(None))
        .order_by(Course.id, User.full_name, ExamAttempt.submitted_at.desc())
        .all()
    )
    if not attempt_rows:
        return GradesMatrixOut(rows=[])

    attempt_ids = [attempt.id for attempt, _, _ in attempt_rows]
    correct_counts = dict(
        db.query(QuestionAttempt.exam_attempt_id, func.count(QuestionAttempt.id))
        .filter(QuestionAttempt.exam_attempt_id.in_(attempt_ids), QuestionAttempt.is_correct.is_(True))
        .group_by(QuestionAttempt.exam_attempt_id)
        .all()
    )

    # Per-student trailing-window average, scoped to this teacher's exams
    # only (never another teacher's, even for the same student).
    month_cutoff = datetime.now(timezone.utc) - timedelta(days=MONTH_WINDOW_DAYS)
    month_avg_rows = (
        db.query(ExamAttempt.user_id, func.avg(ExamAttempt.score_percent))
        .join(Exam, Exam.id == ExamAttempt.exam_id)
        .filter(
            Exam.course_id.in_(course_ids),
            ExamAttempt.submitted_at.isnot(None),
            ExamAttempt.submitted_at >= month_cutoff,
        )
        .group_by(ExamAttempt.user_id)
        .all()
    )
    month_avg_by_user = {user_id: float(avg) for user_id, avg in month_avg_rows if avg is not None}

    # Per-student, per-chapter all-time average.
    chapter_avg_rows = (
        db.query(ExamAttempt.user_id, Exam.course_id, func.avg(ExamAttempt.score_percent))
        .join(Exam, Exam.id == ExamAttempt.exam_id)
        .filter(Exam.course_id.in_(course_ids), ExamAttempt.submitted_at.isnot(None))
        .group_by(ExamAttempt.user_id, Exam.course_id)
        .all()
    )
    chapter_avg_by_user_course = {
        (user_id, course_id): float(avg) for user_id, course_id, avg in chapter_avg_rows if avg is not None
    }

    rows: list[StudentExamGradeRow] = []
    for attempt, exam, user in attempt_rows:
        rows.append(
            StudentExamGradeRow(
                user_id=user.id,
                full_name=user.full_name,
                email=user.email,
                student_code=None,
                course_id=exam.course_id,
                course_title=course_titles.get(exam.course_id, ""),
                exam_id=exam.id,
                exam_title=exam.title,
                correct_count=correct_counts.get(attempt.id, 0),
                question_count=question_counts.get(exam.id, 0),
                score_percent=attempt.score_percent,
                submitted_at=attempt.submitted_at,
                month_avg_score_percent=month_avg_by_user.get(user.id),
                chapter_avg_score_percent=chapter_avg_by_user_course.get((user.id, exam.course_id)),
            )
        )

    return GradesMatrixOut(rows=rows)


@router.get("/{course_id}/student-report", response_model=CourseStudentReportOut)
def course_student_report(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> CourseStudentReportOut:
    """One row per student who has touched this chapter at all (opened a
    lecture, or attempted an exam) — see StudentReportRow for why there's no
    fixed roster to start from. Answers "who hasn't watched X / hasn't taken
    Y" directly: missing_lesson_titles/missing_exam_titles are exactly the
    titles a given student has zero activity on."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_course(db, current_user, course_id)

    lessons = db.query(Lesson).filter(Lesson.course_id == course_id).order_by(Lesson.order_index).all()
    lesson_titles = {lesson.id: lesson.title for lesson in lessons}

    exams = db.query(Exam).filter(Exam.course_id == course_id).order_by(Exam.order_index).all()
    exam_titles = {exam.id: exam.title for exam in exams}

    watched_by_user: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    if lesson_titles:
        rows = (
            db.query(LessonProgress.user_id, LessonProgress.lesson_id)
            .filter(LessonProgress.lesson_id.in_(lesson_titles.keys()))
            .all()
        )
        for user_id, lesson_id in rows:
            watched_by_user[user_id].add(lesson_id)

    # Only a completed attempt (submitted_at set) counts as "took the exam"
    # — same rule as everywhere else exam results are surfaced (see
    # my_dashboard above and _annotate_exam_gate below).
    attempted_by_user: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    if exam_titles:
        rows = (
            db.query(ExamAttempt.user_id, ExamAttempt.exam_id)
            .filter(ExamAttempt.exam_id.in_(exam_titles.keys()), ExamAttempt.submitted_at.isnot(None))
            .all()
        )
        for user_id, exam_id in rows:
            attempted_by_user[user_id].add(exam_id)

    # Per-student skip totals, scoped to just this chapter's lectures (see
    # StudentReportRow.skip_count/skipped_seconds) — unlike the dashboard's
    # video_skip_flags, which rolls up across every managed chapter.
    skip_totals_by_user: dict[uuid.UUID, tuple[int, int]] = {}
    if lesson_titles:
        rows = (
            db.query(
                LessonProgress.user_id,
                func.sum(LessonProgress.skip_count),
                func.sum(LessonProgress.skipped_seconds),
            )
            .filter(LessonProgress.lesson_id.in_(lesson_titles.keys()))
            .group_by(LessonProgress.user_id)
            .all()
        )
        skip_totals_by_user = {user_id: (skip_count or 0, skipped_seconds or 0) for user_id, skip_count, skipped_seconds in rows}

    student_ids = set(watched_by_user) | set(attempted_by_user)
    students_out: list[StudentReportRow] = []
    if student_ids:
        users = db.query(User).filter(User.id.in_(student_ids)).all()
        for u in users:
            watched_ids = watched_by_user.get(u.id, set())
            attempted_ids = attempted_by_user.get(u.id, set())
            skip_count, skipped_seconds = skip_totals_by_user.get(u.id, (0, 0))
            students_out.append(
                StudentReportRow(
                    user_id=u.id,
                    full_name=u.full_name,
                    email=u.email,
                    watched_lessons_count=len(watched_ids),
                    missing_lesson_titles=[title for lid, title in lesson_titles.items() if lid not in watched_ids],
                    attempted_exams_count=len(attempted_ids),
                    missing_exam_titles=[title for eid, title in exam_titles.items() if eid not in attempted_ids],
                    skip_count=skip_count,
                    skipped_seconds=skipped_seconds,
                )
            )
    # Students with the most gaps (unwatched lectures + un-attempted exams)
    # float to the top — the ones actually worth a teacher's attention.
    students_out.sort(key=lambda s: len(s.missing_lesson_titles) + len(s.missing_exam_titles), reverse=True)

    return CourseStudentReportOut(
        course_id=course.id,
        course_title=course.title,
        lectures_count=len(lesson_titles),
        exams_count=len(exam_titles),
        students=students_out,
    )


@router.post("", response_model=CourseOut, status_code=201)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Course:
    """Admins create a chapter "slot" under any subject and may assign it to
    any teacher card (subject_id/teacher_id come straight from the request,
    as before). An instructor can now also add their own chapters — but
    scoped to their own linked teacher card: whatever subject_id/teacher_id
    they send is ignored and replaced with the subject/teacher of their own
    TeacherProfile (see app/models/teacher.py's user_id), so they can never
    file a chapter under someone else's teacher card or a subject they have
    no card in. An instructor with no linked teacher card yet (nobody has
    linked their account — see app/api/routes/teachers.py's
    link_teacher_account) gets a 403 telling them to ask an admin first,
    same spirit as ensure_can_manage_course's error in app/api/deps.py."""
    subject_id = payload.subject_id
    teacher_id = payload.teacher_id

    if current_user.role == UserRole.instructor:
        profile = db.query(TeacherProfile).filter(TeacherProfile.user_id == current_user.id).first()
        if not profile:
            raise HTTPException(
                status_code=403,
                detail="Your account isn't linked to a teacher card yet — ask an admin to link it first.",
            )
        subject_id = profile.subject_id
        teacher_id = profile.id
    elif subject_id is None:
        raise HTTPException(status_code=400, detail="subject_id is required")

    course = Course(
        subject_id=subject_id,
        title=payload.title,
        description=payload.description,
        grade_level=payload.grade_level,
        teacher_id=teacher_id,
        cover_image_url=payload.cover_image_url,
        order_index=payload.order_index,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.put("/{course_id}", response_model=CourseOut)
def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    fields = payload.model_dump(exclude_unset=True)
    old_cover_image_url = course.cover_image_url if "cover_image_url" in fields else None

    for field, value in fields.items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)

    if old_cover_image_url is not None and old_cover_image_url != course.cover_image_url:
        b2_storage.delete_object_for_url(old_cover_image_url)

    return course


@router.delete("/{course_id}", status_code=204)
def delete_course(
    course_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Deleting the course cascades to its lessons at the ORM level (see
    # Course.lessons' cascade="all, delete-orphan"), but that cascade never
    # runs OUR cleanup code per-lesson — so their video files would silently
    # become permanent orphans in R2 without this. Captured before the
    # delete for the same reason as cover_image_url below: gone from the DB
    # after commit either way.
    stale_urls = [course.cover_image_url] + [lesson.video_url for lesson in course.lessons]

    db.delete(course)
    db.commit()

    for url in stale_urls:
        b2_storage.delete_object_for_url(url)
