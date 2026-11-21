"""Study-activity days and the day streak built from them.

A "day" is a Cairo calendar day, so a student studying at 11pm and again at
1am the next night gets two days, matching what they'd expect locally rather
than the server's UTC clock.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.activity import UserActivityDay

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Africa/Cairo")
except Exception:  # no IANA tz database installed (e.g. bare Windows Python)
    _TZ = timezone(timedelta(hours=2))


def local_today() -> date:
    return datetime.now(_TZ).date()


def record_activity(db: Session, user_id: uuid.UUID) -> None:
    """Marks today as an active day for this user. Idempotent; the caller's
    own commit persists it."""
    db.execute(
        pg_insert(UserActivityDay)
        .values(user_id=user_id, day=local_today())
        .on_conflict_do_nothing(index_elements=["user_id", "day"])
    )


def current_streak(db: Session, user_id: uuid.UUID) -> tuple[int, bool]:
    """(streak length in days, whether today is already counted). A streak
    is still alive if the last active day was yesterday — the student has
    until the end of today to keep it going."""
    days = {
        d
        for (d,) in db.query(UserActivityDay.day)
        .filter(UserActivityDay.user_id == user_id)
        .order_by(UserActivityDay.day.desc())
        .limit(400)
        .all()
    }
    today = local_today()
    active_today = today in days
    cursor = today if active_today else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak, active_today
