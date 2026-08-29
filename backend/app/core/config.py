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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
