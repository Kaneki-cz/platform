import uuid

from pydantic import BaseModel, EmailStr


class TeacherOut(BaseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    name: str
    photo_url: str | None = None
    order_index: int
    # The real instructor account linked to this display card, if any — see
    # app/models/teacher.py's user_id. linked_email/linked_full_name aren't
    # real columns on TeacherProfile, so these three are always built by
    # hand in app/api/routes/teachers.py (joined from the linked User row),
    # never left to a bare model_validate() off the raw ORM object.
    user_id: uuid.UUID | None = None
    linked_email: str | None = None
    linked_full_name: str | None = None

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


class TeacherLink(BaseModel):
    """Links a real instructor account (found by email — they must already
    have registered) to this teacher profile — see
    app/api/routes/teachers.py's link_teacher_account."""

    email: EmailStr
