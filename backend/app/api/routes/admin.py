import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.database import get_db
from app.models.user import User, UserRole
from app.schemas.auth import AiBonusGrant, AiLimitUpdate, RoleUpdate, UserOut

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> list[User]:
    return db.query(User).order_by(User.created_at).all()


@router.put("/users/{user_id}/role", response_model=UserOut)
def set_user_role(
    user_id: uuid.UUID,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    if payload.role not in {r.value for r in UserRole}:
        raise HTTPException(status_code=400, detail='role must be "student", "instructor", or "admin"')

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id and payload.role != UserRole.admin.value:
        raise HTTPException(status_code=400, detail="You can't demote yourself")

    user.role = UserRole(payload.role)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/ai-limit", response_model=UserOut)
def set_user_ai_limit(
    user_id: uuid.UUID,
    payload: AiLimitUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> User:
    """Overrides how many AI-assistant questions this one account gets per
    day, replacing the free/pro plan default entirely (see
    app/models/user.py's effective_ai_daily_limit). `daily_limit: null`
    clears the override. Works on the calling admin's own account too — an
    admin who wants a bigger (or unlimited-feeling) quota for themselves
    just calls this with their own user_id, same as for anyone else.
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.ai_daily_limit_override = payload.daily_limit
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/ai-bonus", response_model=UserOut)
def grant_ai_bonus_questions(
    user_id: uuid.UUID,
    payload: AiBonusGrant,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> User:
    """Grants `extra` more AI questions for TODAY only — e.g. a student ran
    out and asked for a few more. Stacks with any bonus already granted
    today (two +5 grants the same day add up to +10); a leftover bonus from
    a previous day is replaced rather than added to, since it no longer
    applies anyway (see User.ai_bonus_questions_today).
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    today = datetime.now(timezone.utc).date()
    current_bonus = user.ai_bonus_questions if user.ai_bonus_questions_date == today else 0
    user.ai_bonus_questions = current_bonus + payload.extra
    user.ai_bonus_questions_date = today
    db.commit()
    db.refresh(user)
    return user
