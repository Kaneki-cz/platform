import uuid

from pydantic import BaseModel


class AskRequest(BaseModel):
    session_id: uuid.UUID | None = None  # None => start a new session
    question: str
    # Base64-encoded photo bytes (no "data:image/...;base64," prefix) of a
    # problem the student attached instead of/alongside typing it out.
    # Optional — see app/services/ai_service.py's image-aware branch.
    image_base64: str | None = None


class VisualizationPayload(BaseModel):
    """Structured render instructions the mobile app turns into a diagram/graph.

    `type` selects the renderer on the client (see docs/visualization_schema.md).
    `data` is renderer-specific and intentionally left as a free-form dict here.
    """

    type: str
    data: dict


class AskResponse(BaseModel):
    session_id: uuid.UUID
    answer: str
    steps: list[str] = []
    visualization: VisualizationPayload | None = None
    # Lets the app show "X questions left today" and give a clear heads-up
    # before the student actually hits the wall. None = unlimited (always
    # true for admins). `daily_limit` is the TOTAL available today — the
    # account's base limit plus any bonus_questions_today granted for just
    # today (see app/models/user.py) — not the permanent daily limit alone.
    remaining_today: int | None
    daily_limit: int | None
    bonus_questions_today: int = 0


class UsageResponse(BaseModel):
    """What GET /api/v1/ai/usage returns — lets the app show today's quota
    the moment the Assistant screen opens, before any question is sent."""

    used_today: int
    daily_limit: int | None
    remaining_today: int | None
    bonus_questions_today: int = 0
