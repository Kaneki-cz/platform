import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.database import get_db
from app.models.course import Course
from app.models.teacher import TeacherProfile
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None or "sub" not in payload:
        raise credentials_exception

    user = db.get(User, payload["sub"])
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_instructor_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.instructor, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Instructor access required")
    return current_user


def ensure_can_manage_course(db: Session, user: User, course_id: uuid.UUID) -> None:
    """Raise 403 unless `user` may create/edit lessons/exams/questions within
    `course_id` (a "chapter" in the app's UI).

    Admins can manage every course — they're the ones who create the
    chapter "slots" and assign a display-card teacher to each (see
    app/api/routes/courses.py). An instructor can only manage a course whose
    `teacher_id` points at a TeacherProfile that's linked to their own
    account (TeacherProfile.user_id — see app/api/routes/teachers.py's
    link_teacher_account). This replaces the old subject-wide
    SubjectInstructor grant (app/models/subject.py, kept in the DB but no
    longer consulted here) — an instructor's edit access is now scoped to
    the specific chapter(s) their linked teacher card is assigned to, not
    every chapter in the whole subject.
    """
    if user.role == UserRole.admin:
        return

    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    linked = (
        course.teacher_id is not None
        and db.query(TeacherProfile.id)
        .filter(TeacherProfile.id == course.teacher_id, TeacherProfile.user_id == user.id)
        .first()
        is not None
    )
    if not linked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the instructor assigned to this chapter",
        )
