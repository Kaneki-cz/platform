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
    # NULL = unlimited (the default) — see app/models/lesson.py's max_views
    # comment. Exposed on every LessonOut (harmless to show; it's just a
    # setting, not a secret) so the admin lecture-edit form can prefill it.
    max_views: int | None = None

    model_config = {"from_attributes": True}


class LessonDetailOut(LessonOut):
    content: str | None = None
    # The next three are only ever computed for a signed-in STUDENT on a
    # max_views-capped lesson — see app/api/routes/lessons.py's get_lesson.
    # They stay None/False for instructors/admins (never capped) and for
    # uncapped lessons, so the mobile app can tell "not applicable" apart
    # from "0 views left" (views_allowed would be a real number in that case).
    views_used: int | None = None
    views_allowed: int | None = None
    view_limit_reached: bool = False


class LessonCreate(BaseModel):
    course_id: uuid.UUID
    title: str
    content: str | None = None
    video_url: str | None = None
    order_index: int = 0
    max_views: int | None = None


class LessonUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    video_url: str | None = None
    order_index: int | None = None
    max_views: int | None = None


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
