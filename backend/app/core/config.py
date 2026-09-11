"""Centralized application configuration.

Loaded once from environment variables / .env file via pydantic-settings.
Every other module should import `settings` from here rather than reading
os.environ directly, so there is exactly one source of truth for config.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_NAME: str = "Physics Educational Platform API"
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = "change-me-to-a-long-random-string"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"

    # Database
    DATABASE_URL: str = "postgresql+psycopg2://physics_user:physics_pass@localhost:5432/physics_db"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # AI — backend-only, never exposed to the mobile app. Defaults point at
    # Gemini's free tier via its OpenAI-compatible endpoint (no GPU server to
    # host); override in .env to swap providers, since qwen_client.py just
    # speaks the generic OpenAI chat-completions protocol.
    #
    # 2026-09-09: moved off "gemini-flash-lite-latest" to the full
    # "gemini-2.5-flash" — noticeably better at reading messy student photos
    # (handwriting, diagrams) and general reasoning than Flash-Lite, which is
    # Gemini's cheapest/weakest tier. Deliberately NOT Gemini 2.5 Pro: on the
    # free tier, Pro's daily quota (100 requests/day *per project*) is too
    # tight for our student count, while Flash's (250/day/project) leaves
    # real headroom across our 3 rotated free projects (~750/day total).
    # Also using the explicit versioned name instead of a "-latest" alias so
    # Google can't silently swap the underlying model on us.
    QWEN_API_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    QWEN_API_KEY: str = "change-me"
    QWEN_MODEL_NAME: str = "gemini-2.5-flash"

    # Usage limits — deliberately conservative while we're still on Gemini's
    # FREE tier (confirmed 2026-09-09: Cloud Billing is disabled on all 3
    # projects behind QWEN_API_KEY). Free-tier quota is shared across EVERY
    # student, not per-student: gemini-2.5-flash's free quota is ~250
    # requests/day per project, and with 3 rotated projects that's a hard
    # ceiling of ~750 requests/day for the whole app. With ~375 students
    # across all teachers, the old limits (20/day free, 500/day pro) could
    # let usage blow past that shared ceiling on a busy day (e.g. before an
    # exam), after which requests start failing over to the weak local
    # fallback or erroring out for everyone, not just the heavy user.
    # These lower numbers buy headroom while still being generous for real
    # homework use. IMPORTANT: this ceiling is a Google free-tier quota
    # problem, not a money problem — see qwen_client.py's docstring on the
    # rotated-keys trick. The actual per-request cost even on a paid model
    # is a small fraction of a cent, so once Cloud Billing is enabled on the
    # project, this whole shared-ceiling risk goes away and these can be
    # raised back up (tie the new numbers to the pricing plan instead, not
    # to Google's rate limit).
    AI_DAILY_REQUEST_LIMIT_FREE: int = 8
    AI_DAILY_REQUEST_LIMIT_PRO: int = 25

    # Video storage — any S3-compatible object store, spoken to via boto3 in
    # app/services/b2_storage.py. Originally Backblaze B2 (hence the B2_*
    # names — kept as-is on purpose after moving to Cloudflare R2, since the
    # database already has "b2:<key>" markers stored in Lesson.video_url /
    # TeacherProfile.photo_url / Course.cover_image_url and there's no
    # reason to rename a working scheme just because the provider behind it
    # changed). Lecture videos live here instead of this server's own disk,
    # since this server's home-internet upload speed is far too slow to
    # stream video to students directly (measured ~0.91 Mbit/s). The bucket
    # is PRIVATE, so app/api/routes/uploads.py hands out short-lived signed
    # URLs on demand instead of a permanent public link — see
    # get_video_signed_url there. Leave B2_KEY_ID empty to fall back to the
    # old local-disk /media/videos storage (useful for local dev without a
    # bucket at all).
    B2_KEY_ID: str = ""
    B2_APPLICATION_KEY: str = ""
    B2_BUCKET_NAME: str = ""
    # Backblaze B2: e.g. "s3.us-west-004.backblazeb2.com" (shown on the
    # bucket's details page in the B2 dashboard).
    # Cloudflare R2: "<ACCOUNT_ID>.r2.cloudflarestorage.com" — ACCOUNT_ID is
    # shown on the R2 Overview page in the Cloudflare dashboard.
    # No "https://" prefix either way.
    B2_ENDPOINT: str = ""
    # Backblaze B2: e.g. "us-west-004" — the leading segment of B2_ENDPOINT.
    # Cloudflare R2: always the literal string "auto" (R2 has no real
    # regions; boto3/S3 still requires something non-empty here).
    B2_REGION: str = ""

    # Security-event notifications (currently just the mobile app's hidden
    # server-settings screen reporting an access attempt — see
    # app/api/routes/security.py). Leave both empty to disable: the endpoint
    # silently no-ops instead of erroring, so the app never breaks over this
    # being unconfigured. TELEGRAM_BOT_TOKEN comes from @BotFather;
    # TELEGRAM_CHAT_ID is the numeric chat id the bot should message (get it
    # by messaging the bot once, then GET
    # https://api.telegram.org/bot<TOKEN>/getUpdates and reading
    # result[0].message.chat.id).
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # Email (SMTP) — sends the sign-up verification code (see
    # app/services/email_service.py and app/api/routes/auth.py's /register,
    # /verify-email, /resend-verification). Leave SMTP_USERNAME empty to
    # disable real sending: the code is only logged to the server console
    # instead (useful for local dev without a real inbox) — but this MUST be
    # configured before shipping to real students, or they will never
    # receive their code and can never finish signing up.
    #
    # Quickest setup — a personal Gmail account:
    #   1. Turn on 2-Step Verification: https://myaccount.google.com/security
    #   2. Create an App Password: https://myaccount.google.com/apppasswords
    #      (pick "Mail" as the app) — a 16-character password, NOT your
    #      normal Gmail password.
    #   3. SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USERNAME=that Gmail
    #      address, SMTP_PASSWORD=the 16-character App Password,
    #      SMTP_FROM_EMAIL=same Gmail address.
    # Gmail's free personal-account sending cap is roughly 500 messages/day —
    # fine for a course's worth of signups. A transactional provider
    # (SendGrid/Resend/Mailgun) is the better fit once that stops being
    # enough; they speak the same SMTP protocol, so only these settings
    # change, not any code.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME: str = "منصة الفيزياء"

    # Gmail API (OAuth2) — preferred send path once GMAIL_OAUTH_REFRESH_TOKEN
    # is set (see email_service.py). Added 2026-09 after plain SMTP login to
    # a Gmail account kept getting hit with "534 5.7.9 ... WebLoginRequired"
    # / an account-wide "session expired" security check — that's specific
    # to legacy SMTP-AUTH; the Gmail API with a real OAuth2 refresh token is
    # Google's own sanctioned way for an app to send mail and isn't subject
    # to the same "insecure sign-in" flagging. One-time setup: run
    # backend/get_gmail_refresh_token.py once (see its own docstring) to get
    # these three values — after that they never need to change. Sends
    # "From" the same SMTP_FROM_EMAIL/SMTP_FROM_NAME above. Leave all three
    # empty to keep using plain SMTP (SMTP_* above) instead — both paths
    # stay supported, see email_service.py.
    GMAIL_OAUTH_CLIENT_ID: str = ""
    GMAIL_OAUTH_CLIENT_SECRET: str = ""
    GMAIL_OAUTH_REFRESH_TOKEN: str = ""

    # Kill switch for the whole email-verification gate — added 2026-09-11
    # after Gmail started rejecting our SMTP login (534 5.7.9
    # WebLoginRequired) and locked every new student out of registering.
    # False means: /register creates the account already verified (no code
    # issued, no email attempted) and /login stops checking is_verified at
    # all — so accounts that got stuck unverified during an SMTP outage can
    # log in immediately too, not just new ones. Left as True by default:
    # the actual SMTP problem got fixed by switching to a different Gmail
    # account (see SMTP_* below), not by disabling verification — this flag
    # is just kept in place as a fast, no-deploy-needed escape hatch (flip
    # to false in .env, restart) if SMTP breaks again in the future. No
    # other code needs to change either way — see auth.py's
    # register()/login().
    REQUIRE_EMAIL_VERIFICATION: bool = True

    # Minutes a verification code stays valid before the student must
    # request a new one.
    VERIFICATION_CODE_EXPIRE_MINUTES: int = 10
    # Seconds that must pass before /resend-verification will send another
    # code for the same account — a simple per-account throttle so the
    # resend button can't be used to spam one inbox.
    VERIFICATION_RESEND_COOLDOWN_SECONDS: int = 60
    # Wrong-code attempts allowed against one outstanding code before it's
    # invalidated and a new one must be requested via /resend-verification.
    VERIFICATION_MAX_ATTEMPTS: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
