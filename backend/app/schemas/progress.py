import uuid

from pydantic import BaseModel, Field


class ProgressUpdate(BaseModel):
    lesson_id: uuid.UUID
    completion_percent: float = Field(ge=0, le=100)


class ProgressOut(BaseModel):
    lesson_id: uuid.UUID
    completion_percent: float

    model_config = {"from_attributes": True}
