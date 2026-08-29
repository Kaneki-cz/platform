import uuid

from pydantic import BaseModel, EmailStr

from app.schemas.course import CourseOut


class SubjectOut(BaseModel):
    id: uuid.UUID
    name: str
    order_index: int

    model_config = {"from_attributes": True}


class SubjectDetailOut(SubjectOut):
    courses: list[CourseOut] = []


class SubjectCreate(BaseModel):
    name: str
    order_index: int = 0


class InstructorAssign(BaseModel):
    email: EmailStr


class InstructorOut(BaseModel):
    user_id: uuid.UUID
    email: EmailStr
    full_name: str | None = None
