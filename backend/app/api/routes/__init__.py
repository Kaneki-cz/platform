from fastapi import APIRouter

from app.api.routes import admin, ai_chat, auth, courses, lessons, progress, subjects, uploads

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(subjects.router)
api_router.include_router(courses.router)
api_router.include_router(lessons.router)
api_router.include_router(progress.router)
api_router.include_router(ai_chat.router)
api_router.include_router(admin.router)
api_router.include_router(uploads.router)
