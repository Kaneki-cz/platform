import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.exam import Exam, ExamAttempt
from app.models.lesson import Lesson
from app.models.lesson_access_code import LessonAccessCode
from app.models.progress import LessonProgress
from app.models.question import Question, QuestionAttempt
from app.models.user import User, UserRole
from app.schemas.course import CourseCreate, CourseDetailOut, CourseOut, CourseUpdate, ExamSummaryOut
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


@router.post("", response_model=CourseOut, status_code=201)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_instructor_or_admin),
) -> Course:
    ensure_can_manage_subject(db, current_user, payload.subject_id)
    course = Course(
        subject_id=payload.subject_id,
        title=payload.title,
        description=payload.description,
        grade_level=payload.grade_level,
        teacher_id=payload.teacher_id,
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
    current_user: User = Depends(require_instructor_or_admin),
) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_subject(db, current_user, course.subject_id)

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
    current_user: User = Depends(require_instructor_or_admin),
) -> None:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    ensure_can_manage_subject(db, current_user, course.subject_id)

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
