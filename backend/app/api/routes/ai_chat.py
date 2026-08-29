"""AI Physics Assistant endpoint.

This is the ONLY path through which a physics question ever reaches the AI
model. The mobile app calls this endpoint (with its normal JWT auth); this
router is the one place that talks to `app.services.ai_service`, which in
turn talks to the AI model (Gemini's free tier by default) and the physics
solver. The AI API key/base URL never leave the backend process (see
app/core/config.py + .env.example).
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.database import get_db
from app.models.chat import ChatMessage, ChatSession
from app.models.user import User
from app.schemas.chat import AskRequest, AskResponse, UsageResponse, VisualizationPayload
from app.services.ai_service import answer_physics_question

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

# A base64 photo bigger than this is almost certainly a full-resolution
# camera original that wasn't downsized — reject it early with a clear
# message rather than a slow request that might time out regardless.
MAX_IMAGE_BASE64_CHARS = 8_000_000  # ~6 MB decoded


def _used_today(db: Session, user: User) -> int:
    """Counts this user's questions (user-role chat messages) sent since
    midnight UTC, across all of their sessions.

    Backed by the existing Postgres tables rather than a Redis counter (an
    earlier version of this file had a TODO suggesting Redis) — Redis is an
    optional dependency here (see .env.example) that may not actually be
    running wherever this is deployed, while Postgres is already required
    for the app to function at all, so counting against it needs nothing
    new to install or keep alive.
    """
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    count = (
        db.query(func.count(ChatMessage.id))
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(
            ChatSession.user_id == user.id,
            ChatMessage.role == "user",
            ChatMessage.created_at >= start_of_day,
        )
        .scalar()
    )
    return count or 0


@router.get("/usage", response_model=UsageResponse)
def get_usage(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UsageResponse:
    """Lets the app show today's remaining question count the moment the
    Assistant screen opens, before the student has sent anything."""
    used = _used_today(db, current_user)
    bonus = current_user.ai_bonus_questions_today
    base_limit = current_user.effective_ai_daily_limit
    if base_limit is None:  # unlimited (always true for admins)
        return UsageResponse(used_today=used, daily_limit=None, remaining_today=None, bonus_questions_today=bonus)

    total_today = base_limit + bonus
    return UsageResponse(
        used_today=used,
        daily_limit=total_today,
        remaining_today=max(0, total_today - used),
        bonus_questions_today=bonus,
    )


@router.post("/ask", response_model=AskResponse)
async def ask_physics_assistant(
    payload: AskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AskResponse:
    if payload.image_base64 and len(payload.image_base64) > MAX_IMAGE_BASE64_CHARS:
        raise HTTPException(status_code=413, detail="This photo is too large — try a smaller or lower-quality one.")

    used = _used_today(db, current_user)
    bonus = current_user.ai_bonus_questions_today
    base_limit = current_user.effective_ai_daily_limit
    # None = unlimited (always true for admins) — skip the check entirely.
    total_today = None if base_limit is None else base_limit + bonus
    if total_today is not None and used >= total_today:
        raise HTTPException(
            status_code=429,
            detail=f"You've reached today's limit of {total_today} questions. It resets at midnight (UTC).",
        )

    if payload.session_id:
        session = db.get(ChatSession, payload.session_id)
        if not session or session.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Chat session not found")
    else:
        session = ChatSession(user_id=current_user.id, title=payload.question[:60] or "Photo question")
        db.add(session)
        db.flush()

    # Grab prior turns *before* adding this question, so the model gets
    # actual conversation context (e.g. a follow-up like "give me an
    # example" otherwise has no idea what topic is being discussed).
    # Capped to the last 10 messages (~5 exchanges) to keep each request's
    # payload reasonable — this is chat history, not the whole transcript.
    history = [{"role": m.role, "content": m.content} for m in session.messages[-10:]]

    db.add(ChatMessage(session_id=session.id, role="user", content=payload.question or "[photo]"))

    result = await answer_physics_question(payload.question, history=history, image_base64=payload.image_base64)

    db.add(
        ChatMessage(
            session_id=session.id,
            role="assistant",
            content=result.answer,
            visualization=result.visualization.model_dump() if result.visualization else None,
        )
    )
    db.commit()

    remaining = None if total_today is None else max(0, total_today - (used + 1))
    return AskResponse(
        session_id=session.id,
        answer=result.answer,
        steps=result.steps,
        visualization=result.visualization,
        remaining_today=remaining,
        daily_limit=total_today,
        bonus_questions_today=bonus,
    )


@router.get("/sessions/{session_id}/history")
def get_chat_history(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return [
        {"role": m.role, "content": m.content, "visualization": m.visualization, "created_at": m.created_at}
        for m in session.messages
    ]
