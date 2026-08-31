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

    # Video storage (Backblaze B2, via its S3-compatible API) — lecture
    # videos live here instead of this server's own disk, since this
    # server's home-internet upload speed is far too slow to stream video to
    # students directly (measured ~0.91 Mbit/s). The bucket is PRIVATE (a
    # free B2 account can't make a bucket public without adding a payment
    # method), so app/api/routes/uploads.py hands out short-lived signed
    # URLs on demand instead of a permanent public link — see
    # get_video_signed_url there. Leave B2_KEY_ID empty to fall back to the
    # old local-disk /media/videos storage (useful for local dev without a
    # B2 account).
    B2_KEY_ID: str = ""
    B2_APPLICATION_KEY: str = ""
    B2_BUCKET_NAME: str = ""
    # e.g. "s3.us-west-004.backblazeb2.com" — shown on the bucket's details
    # page in the B2 dashboard. No "https://" prefix.
    B2_ENDPOINT: str = ""
    # e.g. "us-west-004" — the leading segment of B2_ENDPOINT.
    B2_REGION: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
