import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AccessCodeGenerateRequest(BaseModel):
    # Capped at 500 per call — plenty for "100 students", and keeps one
    # request from generating an unreasonable batch by typo (e.g. an extra
    # zero).
    count: int = Field(ge=1, le=500)


class AccessCodeOut(BaseModel):
    id: uuid.UUID
    code: str
    redeemed: bool
    redeemed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AccessCodeRedeemRequest(BaseModel):
    code: str


class AccessCodeRedeemResponse(BaseModel):
    lesson_id: uuid.UUID
    course_id: uuid.UUID
    lesson_title: str
