import uuid

from pydantic import BaseModel


class TeacherOut(BaseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    name: str
    photo_url: str | None = None
    order_index: int

    model_config = {"from_attributes": True}


class TeacherCreate(BaseModel):
    subject_id: uuid.UUID
    name: str
    photo_url: str | None = None
    order_index: int = 0


class TeacherUpdate(BaseModel):
    name: str | None = None
    photo_url: str | None = None
    order_index: int | None = None
