import uuid
from datetime import date, datetime

from pydantic import BaseModel


class StudentCodeOut(BaseModel):
    """A student's own permanent QR-code identifier — see GET
    /api/v1/students/me/code. Rendered as a QR code on their own profile
    screen for a teacher/admin to scan."""

    code: str


class AttendanceScanRequest(BaseModel):
    # Whatever the QR payload/manual-entry field contains — normalized
    # (trimmed, uppercased) server-side before lookup, same convention as
    # LessonAccessCode's redeem flow.
    code: str
    group_id: uuid.UUID


class AttendanceScanResult(BaseModel):
    """What the scanner screen shows right after a successful scan — enough
    to flash "اسم الطالب ✓ اتسجل" without a second round trip, and to tell
    apart a fresh scan from one that already happened today (not an error —
    re-scanning the same student in the same session is a harmless no-op)."""

    user_id: uuid.UUID
    full_name: str | None
    email: str
    group_id: uuid.UUID
    group_name: str
    session_date: date
    already_marked: bool


class AttendanceRow(BaseModel):
    """One present student in GET
    /api/v1/teachers/{teacher_id}/groups/{group_id}/attendance."""

    user_id: uuid.UUID
    full_name: str | None
    email: str
    scanned_at: datetime


class GroupAttendanceOut(BaseModel):
    group_id: uuid.UUID
    group_name: str
    session_date: date
    present: list[AttendanceRow] = []
