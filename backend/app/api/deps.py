import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.database import get_db
from app.models.subject import SubjectInstructor
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


def ensure_can_manage_subject(db: Session, user: User, subject_id: uuid.UUID) -> None:
    """Raise 403 unless `user` may create/edit content within `subject_id`.

    Admins can manage every subject. Instructors can only manage subjects
    they've been explicitly assigned to via SubjectInstructor (see
    app/api/routes/subjects.py's instructor-assignment endpoints).
    """
    if user.role == UserRole.admin:
        return
    assigned = (
        db.query(SubjectInstructor)
        .filter(SubjectInstructor.subject_id == subject_id, SubjectInstructor.user_id == user.id)
        .first()
    )
    if not assigned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an instructor for this subject",
        )
