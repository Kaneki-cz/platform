from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.models.course import Course
from app.models.lesson import Lesson
from app.models.progress import LessonProgress
from app.models.user import User
from app.schemas.progress import (
    CourseProgressOut,
    ProgressOut,
    ProgressSkipUpdate,
    ProgressSummaryOut,
    ProgressUpdate,
)
from app.services import activity

# A lesson counts as finished from this completion percent up (the player
# reports in steps, so a fully watched lecture can land a little under 100).
DONE_PERCENT = 90

router = APIRouter(prefix="/api/v1/progress", tags=["progress"])


@router.get("", response_model=list[ProgressOut])
def list_progress(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[LessonProgress]:
    return db.query(LessonProgress).filter(LessonProgress.user_id == current_user.id).all()


@router.put("", response_model=ProgressOut)
def upsert_progress(
    payload: ProgressUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LessonProgress:
    entry = (
        db.query(LessonProgress)
        .filter(
            LessonProgress.user_id == current_user.id,
            LessonProgress.lesson_id == payload.lesson_id,
        )
        .first()
    )
    if entry is None:
        entry = LessonProgress(user_id=current_user.id, lesson_id=payload.lesson_id)
        db.add(entry)

    # Monotonic: replaying a lecture from the start (or re-opening it after
    # finishing) should never make recorded progress go backwards.
    entry.completion_percent = max(entry.completion_percent or 0, payload.completion_percent)
    activity.record_activity(db, current_user.id)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/skip", response_model=ProgressOut)
def report_video_skip(
    payload: ProgressSkipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LessonProgress:
    """Called by the mobile player whenever it detects a forward jump in
    playback bigger than could be normal watching (see
    components/LessonVideoPlayer.tsx on the mobile side) — e.g. dragging the
    scrubber ahead instead of actually watching. Purely additive: bumps this
    student's skip_count/skipped_seconds on this lesson so the Teacher
    Dashboard can flag it (see GET /api/v1/courses/mine/dashboard's
    video_skip_flags). Never blocks or affects completion_percent."""
    entry = (
        db.query(LessonProgress)
        .filter(
            LessonProgress.user_id == current_user.id,
            LessonProgress.lesson_id == payload.lesson_id,
        )
        .first()
    )
    if entry is None:
        entry = LessonProgress(user_id=current_user.id, lesson_id=payload.lesson_id)
        db.add(entry)

    entry.skip_count = (entry.skip_count or 0) + 1
    entry.skipped_seconds = (entry.skipped_seconds or 0) + payload.skipped_seconds
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/summary", response_model=ProgressSummaryOut)
def progress_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProgressSummaryOut:
    """Home-screen numbers in one call: the day streak plus per-course
    progress (average completion over every lesson in the course, unwatched
    lessons counting as 0)."""
    streak, active_today = activity.current_streak(db, current_user.id)

    lessons = db.query(Lesson.id, Lesson.course_id).all()
    by_course: dict = {}
    for lesson_id, course_id in lessons:
        by_course.setdefault(course_id, []).append(lesson_id)

    done = {
        row.lesson_id: row.completion_percent or 0
        for row in db.query(LessonProgress).filter(LessonProgress.user_id == current_user.id).all()
    }

    courses = []
    for course_id, lesson_ids in by_course.items():
        percents = [done.get(lid, 0) for lid in lesson_ids]
        courses.append(
            CourseProgressOut(
                course_id=course_id,
                lesson_count=len(lesson_ids),
                completed_count=sum(1 for pct in percents if pct >= DONE_PERCENT),
                percent=round(sum(percents) / len(percents), 1),
            )
        )
    # Courses with no lessons yet still show up, at 0%.
    known = set(by_course)
    for (course_id,) in db.query(Course.id).all():
        if course_id not in known:
            courses.append(CourseProgressOut(course_id=course_id, lesson_count=0, completed_count=0, percent=0))

    return ProgressSummaryOut(
        streak_days=streak,
        active_today=active_today,
        lessons_completed=sum(1 for pct in done.values() if pct >= DONE_PERCENT),
        courses=courses,
    )
