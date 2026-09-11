import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import create_access_token, generate_verification_code, hash_password, verify_password
from app.db.database import get_db
from app.models.user import User
from app.schemas.auth import ResendVerificationRequest, Token, UserCreate, UserOut, VerifyEmailRequest
from app.services.email_service import send_verification_email

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _issue_new_code(user: User) -> str:
    """Generates a fresh code, stores it on `user` (caller still needs to
    commit), and resets the wrong-attempt counter — shared by /register and
    /resend-verification so the two can never drift out of sync."""
    code = generate_verification_code()
    now = datetime.now(timezone.utc)
    user.verification_code = code
    user.verification_code_expires_at = now + timedelta(minutes=settings.VERIFICATION_CODE_EXPIRE_MINUTES)
    user.verification_code_sent_at = now
    user.verification_attempts = 0
    return code


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # settings.REQUIRE_EMAIL_VERIFICATION is a kill switch (see config.py) —
    # while it's False, skip issuing/sending a code entirely and create the
    # account already verified, so the mobile app can log the student in
    # right away instead of stranding them on a verify screen with no code
    # coming.
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        is_verified=not settings.REQUIRE_EMAIL_VERIFICATION,
    )
    if settings.REQUIRE_EMAIL_VERIFICATION:
        code = _issue_new_code(user)
    db.add(user)
    db.commit()
    db.refresh(user)

    if settings.REQUIRE_EMAIL_VERIFICATION:
        try:
            send_verification_email(user.email, code, user.full_name)
        except Exception:
            # Registration itself still succeeds even if the email fails to go
            # out (bad SMTP creds, provider hiccup, ...) — the student can always
            # retry via /resend-verification once the problem's fixed, rather
            # than losing the account they just created.
            logger.exception("Failed to send verification email to %s", user.email)

    return user


@router.post("/verify-email", response_model=Token)
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)) -> Token:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account with this email")

    if user.is_verified:
        # Already done (e.g. a stale verify screen re-submitted) — log them
        # in instead of erroring, same end state either way.
        access_token = create_access_token(subject=str(user.id))
        return Token(access_token=access_token)

    if not user.verification_code or not user.verification_code_expires_at:
        raise HTTPException(status_code=400, detail="No verification code pending — request a new one")

    if datetime.now(timezone.utc) > user.verification_code_expires_at:
        raise HTTPException(status_code=400, detail="Code expired — request a new one")

    if user.verification_attempts >= settings.VERIFICATION_MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Too many wrong attempts — request a new code")

    if payload.code != user.verification_code:
        user.verification_attempts += 1
        db.commit()
        remaining = settings.VERIFICATION_MAX_ATTEMPTS - user.verification_attempts
        raise HTTPException(status_code=400, detail=f"Incorrect code — {remaining} attempt(s) left")

    user.is_verified = True
    user.verification_code = None
    user.verification_code_expires_at = None
    user.verification_code_sent_at = None
    user.verification_attempts = 0
    db.commit()

    access_token = create_access_token(subject=str(user.id))
    return Token(access_token=access_token)


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
def resend_verification(payload: ResendVerificationRequest, db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account with this email")

    if user.is_verified:
        raise HTTPException(status_code=400, detail="Email already verified")

    if user.verification_code_sent_at:
        elapsed = (datetime.now(timezone.utc) - user.verification_code_sent_at).total_seconds()
        wait = settings.VERIFICATION_RESEND_COOLDOWN_SECONDS - elapsed
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Please wait {int(wait) + 1}s before requesting another code")

    code = _issue_new_code(user)
    db.commit()

    try:
        send_verification_email(user.email, code, user.full_name)
    except Exception:
        logger.exception("Failed to send verification email to %s", user.email)
        raise HTTPException(status_code=500, detail="Could not send the email — try again shortly")

    return {"message": "Verification code sent"}


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    """OAuth2-compatible login (email goes in the `username` field)."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_verified:
        # A distinct status code (403, not 401) so the mobile app can tell
        # "wrong password" apart from "right password, just not verified yet"
        # and route to the verify-email screen instead of showing a plain
        # error — see mobile/app/(auth)/login.tsx. Gated on the kill switch
        # too: with verification disabled, an account that got stuck
        # unverified during the SMTP outage (created before the switch was
        # flipped) can still log in instead of being permanently stranded.
        raise HTTPException(status_code=403, detail="Email not verified")

    access_token = create_access_token(subject=str(user.id))
    return Token(access_token=access_token)


@router.get("/me", response_model=UserOut)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
