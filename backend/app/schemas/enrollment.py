import uuid

from pydantic import BaseModel, field_validator

from app.schemas.course import GradeLevel


class TeacherGroupOut(BaseModel):
    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}


class TeacherGroupCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Group name cannot be blank")
        return v


class EnrollmentStatusOut(BaseModel):
    """Response for GET /api/v1/enrollment/{teacher_id}.

    - enrolled:       True if a membership row exists for (student, teacher)
    - needs_group:    enrolled=True but group_id is NULL while the teacher now
                      has groups — mobile should re-show the group picker
    - available_groups: groups to show in the picker (empty = no groups yet)
    - current_group_id: the group the student is currently assigned to
    - full_name_ar:   student's stored Arabic full name (None = not set yet)
    - grade:          student's stored grade (None = not set yet)
    """

    enrolled: bool
    needs_group: bool
    available_groups: list[TeacherGroupOut]
    current_group_id: uuid.UUID | None = None
    full_name_ar: str | None = None
    grade: str | None = None


class EnrollmentSubmit(BaseModel):
    full_name_ar: str
    grade: GradeLevel
    group_id: uuid.UUID | None = None

    @field_validator("full_name_ar")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("full_name_ar cannot be blank")
        return v


class AdminEnrollmentOut(BaseModel):
    """One enrollment row as seen by an admin."""

    teacher_id: uuid.UUID
    teacher_name: str | None = None
    group_id: uuid.UUID | None = None
    group_name: str | None = None


class AdminGroupUpdate(BaseModel):
    """Admin reassigns a student to a different group (or clears the assignment
    by passing group_id=null)."""

    group_id: uuid.UUID | None = None
