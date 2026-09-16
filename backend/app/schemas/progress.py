import uuid

from pydantic import BaseModel, Field


class ProgressUpdate(BaseModel):
    lesson_id: uuid.UUID
    completion_percent: float = Field(ge=0, le=100)


class ProgressOut(BaseModel):
    lesson_id: uuid.UUID
    completion_percent: float
    skip_count: int = 0
    skipped_seconds: int = 0

    model_config = {"from_attributes": True}


class ProgressSkipUpdate(BaseModel):
    """One detected forward-skip event, reported by the mobile player (see
    components/LessonVideoPlayer.tsx) whenever it sees a jump ahead bigger
    than normal playback could produce. Aggregated server-side onto the
    student's LessonProgress row for this lesson — see POST /skip."""

    lesson_id: uuid.UUID
    skipped_seconds: int = Field(gt=0)


class LessonViewOut(BaseModel):
    """One student's view-count standing on one max_views-capped lesson —
    see app/api/routes/admin.py's GET /users/{id}/lesson-views and the two
    bonus-views/reset-views actions below it, and app/models/progress.py's
    view_count/bonus_views for what these track."""

    lesson_id: uuid.UUID
    lesson_title: str
    course_title: str
    max_views: int
    view_count: int
    bonus_views: int
    views_allowed: int
    view_limit_reached: bool


class BonusViewsGrant(BaseModel):
    # Permanent (unlike the AI daily-question bonus, which is today-only —
    # there's no daily cycle to a view count), so this simply adds to
    # whatever bonus_views already exists.
    extra: int = Field(gt=0)
