from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.models.progress import LessonProgress
from app.models.user import User
from app.schemas.progress import ProgressOut, ProgressSkipUpdate, ProgressUpdate

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
