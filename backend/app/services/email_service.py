"""Sends the sign-up email-verification code — see app/api/routes/auth.py's
/register, /verify-email, /resend-verification, and app/models/user.py's
verification_* columns.

Uses Python's own smtplib/email — no extra dependency, and works with any
real SMTP provider (Gmail app password, SendGrid, Mailgun, Resend, a
school's own mail server, ...). See app/core/config.py's SMTP_* settings for
setup instructions.

If SMTP_USERNAME is left empty (nothing configured — e.g. local dev), this
silently falls back to just logging the code to the server console instead
of raising, so the rest of the signup flow can still be exercised without a
real inbox. That fallback is NOT acceptable for a real deployment serving
real students — configure SMTP_* in production, or students will never
receive a code and can never finish signing up.
"""
import logging
import smtplib
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_verification_email(to_email: str, code: str, full_name: str | None = None) -> None:
    greeting = f"أهلًا {full_name}،" if full_name else "أهلًا،"
    body = (
        f"{greeting}\n\n"
        f"كود التحقق بتاعك عشان تفعّل حسابك في منصة الفيزياء هو:\n\n"
        f"    {code}\n\n"
        f"الكود صالح لمدة {settings.VERIFICATION_CODE_EXPIRE_MINUTES} دقايق. "
        f"لو انتهت صلاحيته تقدر تطلب كود جديد من نفس شاشة التسجيل.\n\n"
        f"لو انت مش اللي طلب التسجيل ده، تقدر تتجاهل الإيميل ده."
    )

    if not settings.SMTP_USERNAME:
        logger.warning(
            "SMTP not configured (SMTP_USERNAME empty) — verification code for %s is: %s "
            "— this ONLY prints to the console; real students will never see it. Set "
            "SMTP_* in .env before shipping to production (see .env.example).",
            to_email,
            code,
        )
        return

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = "كود تفعيل حسابك — منصة الفيزياء"
    from_email = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{from_email}>"
    msg["To"] = to_email

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(from_email, [to_email], msg.as_string())
