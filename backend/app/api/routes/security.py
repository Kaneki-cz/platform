"""Security-event notifications for the app's own defenses.

Currently just one source: the hidden server-settings screen in the mobile
app (mobile/app/server-settings.tsx) reports here whenever someone reaches
it or tries an access code, so whoever runs this platform gets pinged on
Telegram if a student stumbles onto — or deliberately tries to abuse — the
ability to point their app at a different backend.

Deliberately public (no auth): that screen is reachable while logged out on
purpose (see mobile/components/AuthGate.tsx), so there is no token to attach
here either. Also deliberately best-effort: a missing Telegram config or a
failed call to Telegram never turns into an error response, since a
notification going wrong should never be the thing that breaks the app.
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
import httpx

from app.core.config import settings

router = APIRouter(prefix="/api/v1/security", tags=["security"])

_EVENT_LABELS = {
    "opened": "\U0001F4F1 Someone opened the hidden server-settings screen",
    "unlock_success": "\U0001F513 Someone entered the CORRECT server-settings access code",
    "unlock_failed": "❌ Someone entered a WRONG server-settings access code",
}


class ServerSettingsAttempt(BaseModel):
    event: str = Field(pattern="^(opened|unlock_success|unlock_failed)$")


@router.post("/server-settings-attempt", status_code=204)
async def report_server_settings_attempt(payload: ServerSettingsAttempt) -> None:
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        return

    text = _EVENT_LABELS.get(payload.event, f"Server settings event: {payload.event}")
    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json={"chat_id": settings.TELEGRAM_CHAT_ID, "text": text})
    except Exception:
        pass
