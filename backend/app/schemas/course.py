import uuid
from typing import Literal

from pydantic import BaseModel

# The fixed, final set of grade levels a chapter can be filed under —
# confirmed with the user as exactly these 4 Arabic strings, no others.
# Kept as a plain nullable String column at the DB layer (see
# app/models/course.py) and enforced here instead, so adding/renaming a
# grade later is a one-line change, not an ALTER TYPE migration.
GradeLevel = Literal[
    "الصف الأول الثانوي",
    "الصف الثاني الثانوي - بكالوريا",
    "الصف الثاني الثانوي - عام",
    "الصف الثالث الثانوي - عام",
]


class LessonOut(BaseModel):
    id: uuid.UUID
    title: str
    video_url: str | None = None
    order_index: int
    # True when this lesson has no segment quizzes, or the current user has
    # passed every one of them (>=75% correct on their latest attempts) —
    # computed per-request in app/api/routes/courses.py's get_course, since
    # it depends on who's asking. Defaults to True so any endpoint that
    # returns a LessonOut without computing this (e.g. a plain lesson fetch)
    # never accidentally locks something.
    quiz_passed: bool = True

    model_config = {"from_attributes": True}


class LessonDetailOut(LessonOut):
    content: str | None = None


class LessonCreate(BaseModel):
    course_id: uuid.UUID
    title: str
    content: str | None = None
    video_url: str | None = None
    order_index: int = 0


class LessonUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    video_url: str | None = None
    order_index: int | None = None


class CourseOut(BaseModel):
    id: uuid.UUID
    subject_id: uuid.UUID
    title: str
    description: str | None = None
    grade_level: str | None = None
    teacher_id: uuid.UUID | None = None
    cover_image_url: str | None = None
    order_index: int

    model_config = {"from_attributes": True}


class CourseDetailOut(CourseOut):
    lessons: list[LessonOut] = []


class CourseCreate(BaseModel):
    subject_id: uuid.UUID
    title: str
    description: str | None = None
    grade_level: GradeLevel | None = None
    teacher_id: uuid.UUID | None = None
    cover_image_url: str | None = None
    order_index: int = 0


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    grade_level: GradeLevel | None = None
    teacher_id: uuid.UUID | None = None
    cover_image_url: str | None = None
    order_index: int | None = None
