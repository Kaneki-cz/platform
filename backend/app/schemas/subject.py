import uuid

from pydantic import BaseModel

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


# Instructor assignment used to live here (InstructorAssign/InstructorOut,
# backed by SubjectInstructor — a real user granted edit access to a WHOLE
# subject). Removed 2026-09: an instructor's edit access is now scoped to
# specific chapters via a linked TeacherProfile instead — see
# app/schemas/teacher.py's TeacherLink and app/api/deps.py's
# ensure_can_manage_course.
