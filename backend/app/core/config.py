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
    QWEN_API_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    QWEN_API_KEY: str = "change-me"
    QWEN_MODEL_NAME: str = "gemini-flash-lite-latest"

    # Usage limits
    AI_DAILY_REQUEST_LIMIT_FREE: int = 20
    AI_DAILY_REQUEST_LIMIT_PRO: int = 500

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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
