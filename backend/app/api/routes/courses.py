import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ensure_can_manage_subject, get_current_user, require_instructor_or_admin
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.progress import LessonProgress
from app.models.question import Question, QuestionAttempt
from app.models.user import User
from app.schemas.course import CourseCreate, CourseDetailOut, CourseOut, CourseUpdate
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
