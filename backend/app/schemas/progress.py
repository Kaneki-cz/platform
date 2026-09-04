import uuid

from pydantic import BaseModel, Field


class ProgressUpdate(BaseModel):
    lesson_id: uuid.UUID
    completion_percent: float = Field(ge=0, le=100)


class ProgressOut(BaseModel):
    lesson_id: uuid.UUID
    completion_percent: float

    model_config = {"from_attributes": True}


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
