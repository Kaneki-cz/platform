"""Sends the sign-up email-verification code — see app/api/routes/auth.py's
/register, /verify-email, /resend-verification, and app/models/user.py's
verification_* columns.

Two ways to actually send, tried in this order:

1. Gmail API (OAuth2) — used whenever GMAIL_OAUTH_REFRESH_TOKEN is set (see
   app/core/config.py). Added 2026-09 after plain SMTP login to a Gmail
   account kept getting hit with "534 5.7.9 ... WebLoginRequired" / an
   account-wide "session expired" security check from Google — that's
   specific to legacy SMTP-AUTH; the Gmail API with a real OAuth2 refresh
   token is Google's own sanctioned way for an app to send mail and isn't
   subject to the same "insecure sign-in" flagging. One-time setup only:
   run backend/get_gmail_refresh_token.py once per Google account (see its
   own docstring) to get GMAIL_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN — after
   that it never needs to be repeated, and this keeps working indefinitely
   within Gmail's free "500 recipients/day" cap.
2. Plain SMTP (smtplib) — the original path, unchanged, used whenever
   GMAIL_OAUTH_REFRESH_TOKEN is empty but SMTP_USERNAME is set. Works with
   any real SMTP provider (Gmail app password, a proper transactional
   service like Resend/SendGrid/Mailgun, a school's own mail server, ...).

If neither is configured (local dev), this silently falls back to just
logging the code to the server console instead of raising, so the rest of
the signup flow can still be exercised without a real inbox. That fallback
is NOT acceptable for a real deployment serving real students — configure
GMAIL_OAUTH_* or SMTP_* in production, or students will never receive a
code and can never finish signing up.
"""
import base64
import logging
import smtplib
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_message(to_email: str, code: str, full_name: str | None, from_email: str) -> MIMEText:
    greeting = f"أهلًا {full_name}،" if full_name else "أهلًا،"
    body = (
        f"{greeting}\n\n"
        f"كود التحقق بتاعك عشان تفعّل حسابك في منصة الفيزياء هو:\n\n"
        f"    {code}\n\n"
        f"الكود صالح لمدة {settings.VERIFICATION_CODE_EXPIRE_MINUTES} دقايق. "
        f"لو انتهت صلاحيته تقدر تطلب كود جديد من نفس شاشة التسجيل.\n\n"
        f"لو انت مش اللي طلب التسجيل ده، تقدر تتجاهل الإيميل ده."
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = "كود تفعيل حسابك — منصة الفيزياء"
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{from_email}>"
    msg["To"] = to_email
    return msg


def _send_via_gmail_api(to_email: str, code: str, full_name: str | None) -> None:
    # Imported here, not at module level, so a deployment that only uses
    # plain SMTP (GMAIL_OAUTH_REFRESH_TOKEN left empty) never needs these
    # packages installed at all.
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    from_email = settings.SMTP_FROM_EMAIL or "me"
    msg = _build_message(to_email, code, full_name, from_email)

    creds = Credentials(
        token=None,
        refresh_token=settings.GMAIL_OAUTH_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GMAIL_OAUTH_CLIENT_ID,
        client_secret=settings.GMAIL_OAUTH_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/gmail.send"],
    )
    creds.refresh(Request())  # exchanges the long-lived refresh token for a fresh access token

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    service.users().messages().send(userId="me", body={"raw": raw}).execute()


def _send_via_smtp(to_email: str, code: str, full_name: str | None) -> None:
    from_email = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
    msg = _build_message(to_email, code, full_name, from_email)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(from_email, [to_email], msg.as_string())


def send_verification_email(to_email: str, code: str, full_name: str | None = None) -> None:
    if settings.GMAIL_OAUTH_REFRESH_TOKEN:
        _send_via_gmail_api(to_email, code, full_name)
        return

    if not settings.SMTP_USERNAME:
        logger.warning(
            "No email method configured (GMAIL_OAUTH_REFRESH_TOKEN and SMTP_USERNAME both "
            "empty) — verification code for %s is: %s — this ONLY prints to the console; "
            "real students will never see it. Set GMAIL_OAUTH_* (preferred, see "
            "get_gmail_refresh_token.py) or SMTP_* in .env before shipping to production.",
            to_email,
            code,
        )
        return

    _send_via_smtp(to_email, code, full_name)
