import uuid

from pydantic import BaseModel, EmailStr, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str | None = None
    plan: str
    role: str
    # None = no admin override, using the plan-based default. See
    # app/models/user.py's effective_ai_daily_limit for the resolved number
    # actually enforced (read directly off the ORM property below) — also
    # None for role=admin accounts, which are always unlimited.
    ai_daily_limit_override: int | None = None
    effective_ai_daily_limit: int | None = None
    # Extra questions granted for today only, on top of the above — see
    # app/models/user.py's ai_bonus_questions_today.
    ai_bonus_questions_today: int = 0

    model_config = {"from_attributes": True}


class RoleUpdate(BaseModel):
    role: str  # "student" | "instructor" | "admin"


class AiLimitUpdate(BaseModel):
    # None clears the override, reverting this account to the plan default.
    daily_limit: int | None = None

    @field_validator("daily_limit")
    @classmethod
    def _non_negative(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("daily_limit must be 0 or greater")
        return v


class AiBonusGrant(BaseModel):
    """POST body for granting extra questions for today only — see
    app/models/user.py's ai_bonus_questions_today."""

    extra: int

    @field_validator("extra")
    @classmethod
    def _positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("extra must be greater than 0")
        return v


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
