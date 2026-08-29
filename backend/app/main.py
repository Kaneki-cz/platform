from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import api_router
from app.core.config import settings

app = FastAPI(title=settings.APP_NAME)

# In production, restrict this to the mobile app's actual origin(s)/scheme.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Serves uploaded lecture videos back out (see app/api/routes/uploads.py).
# Local-disk storage — fine for development; swap for real object storage
# (S3 or similar) before this goes anywhere near production.
MEDIA_ROOT = Path(__file__).resolve().parent.parent / "media"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_ROOT)), name="media")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "environment": settings.ENVIRONMENT}
