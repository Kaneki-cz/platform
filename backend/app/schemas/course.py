import uuid

from pydantic import BaseModel


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
    order_index: int

    model_config = {"from_attributes": True}


class CourseDetailOut(CourseOut):
    lessons: list[LessonOut] = []


class CourseCreate(BaseModel):
    subject_id: uuid.UUID
    title: str
    description: str | None = None
    grade_level: str | None = None
    order_index: int = 0


class CourseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    grade_level: str | None = None
    order_index: int | None = None
