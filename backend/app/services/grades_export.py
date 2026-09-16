"""Builds the styled .xlsx workbook behind the Teacher Dashboard's
"تحميل كملف Excel" button (GET /api/v1/courses/mine/grades-matrix/export).

One worksheet per chapter (course), so a teacher managing several chapters
gets a tab per chapter instead of one giant undifferentiated table. Every
row ALSO repeats an explicit "الفصل" (Chapter) column — the user flagged
that "متوسط الفصل" was ambiguous once more than one chapter is involved, so
the chapter each row/average belongs to is now spelled out on the row
itself, not left to be inferred from which sheet/tab you're looking at.

Kept deliberately dependency-light: openpyxl only (already a very common,
pure-Python library — no native/OS dependency, so this has zero effect on
the mobile app or the EAS build pipeline described in the project's
deploy-process skill).

COLOR GOTCHA (the reason every color below is an 8-digit "FFrrggbb", never
a bare 6-digit "rrggbb"): openpyxl's Color type silently zero-pads a plain
6-digit hex with "00" alpha (fully transparent) instead of "FF" (opaque) —
confirmed directly against the written XML. Excel desktop mostly ignores
cell-fill alpha and renders the RGB anyway, which is why this looked fine
in a quick desktop check; other spreadsheet apps (WPS among them, going by
a screenshot from an actual phone) DO honor that alpha byte, so every fill
came out as a transparent wash tinted by whatever the app's own theme
accent color underneath happened to be — not the navy/green/red this file
intended. Always spell out the alpha explicitly, here and in any future
edit to this palette.
"""
from __future__ import annotations

import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from app.schemas.course import StudentExamGradeRow


def _solid(hex6: str) -> PatternFill:
    """A fully-opaque solid fill — see the file-level COLOR GOTCHA comment.
    `hex6` is a plain "rrggbb" string; this is the only place "FF" (opaque
    alpha) gets prepended, and fgColor/bgColor are both set to the same
    value since a couple of non-Excel renderers apply a "solid" pattern's
    bgColor instead of its fgColor."""
    argb = f"FF{hex6}"
    return PatternFill(patternType="solid", fgColor=argb, bgColor=argb)


def _rgb_font(hex6: str, **kwargs) -> Font:
    return Font(color=f"FF{hex6}", **kwargs)


# --- palette -------------------------------------------------------------
# "Classic navy" — one of 4 directions mocked up on a design canvas and
# picked by the user over the earlier cyan/teal look (see the design
# canvas shared in-session). Kept as a light spreadsheet surface with a
# dark header band, never a solid dark fill reading white text everywhere
# — that would be exhausting to scroll through in Excel/WPS.
HEADER_FILL = _solid("1E3A8A")  # classic dark navy blue
HEADER_FONT = _rgb_font("FFFFFF", bold=True, size=11, name="Calibri")
TITLE_FONT = _rgb_font("1E3A8A", bold=True, size=13, name="Calibri")
ROW_ALT_FILL = _solid("EFF6FF")  # faint navy-tinted zebra stripe (blue-50)
PASS_FILL = _solid("DCFCE7")  # soft green — echoes colors.success
PASS_FONT = _rgb_font("15803D", bold=True)
FAIL_FILL = _solid("FEE2E2")  # soft red — echoes colors.danger
FAIL_FONT = _rgb_font("B91C1C", bold=True)
NAME_FONT = _rgb_font("111827", bold=True)
BODY_FONT = _rgb_font("374151")
THIN = Side(style="thin", color="FFD8DEE9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEADER_BORDER = Border(
    left=Side(style="thin", color="FF1E3A8A"),
    right=Side(style="thin", color="FF1E3A8A"),
    top=Side(style="thin", color="FF1E3A8A"),
    bottom=Side(style="medium", color="FF1E3A8A"),
)

# order matters — this is the literal column order in the sheet
COLUMNS = [
    ("الطالب", 22),
    ("الإيميل", 26),
    ("الكود", 12),
    # The chapter's own assigned grade level (Course.grade_level — one of
    # the 4 fixed GRADE_LEVELS strings) — added because a full "كل الصفوف"
    # export mixes chapters from every grade level into the same sheet set,
    # and "الفصل" alone (a chapter's TITLE) doesn't tell you which grade
    # that chapter belongs to. "—" for a chapter that was never filed
    # under one. See StudentExamGradeRow.course_grade_level.
    ("الصف", 24),
    ("الفصل", 22),
    ("الامتحان", 22),
    ("الدرجة", 12),
    ("النسبة", 10),
    ("الحالة", 12),
    ("متوسط آخر 30 يوم", 16),
    ("متوسط الفصل", 14),
    ("تاريخ التسليم", 18),
]

# 1-indexed column position of "الحالة" above — kept as a named constant
# rather than a magic 8/9 in _write_sheet, since inserting/removing a
# column above (like "الصف" was) shifts it and is easy to forget.
STATUS_COL = next(i for i, (label, _) in enumerate(COLUMNS, start=1) if label == "الحالة")

_INVALID_SHEET_CHARS = re.compile(r"[:\\/?*\[\]]")


def _safe_sheet_title(title: str, used: set[str]) -> str:
    """openpyxl sheet titles: max 31 chars, and none of : \\ / ? * [ ] —
    dedup on collision (two chapters with the same/truncated name) by
    appending a numeric suffix."""
    cleaned = _INVALID_SHEET_CHARS.sub(" ", title).strip() or "الفصل"
    base = cleaned[:31]
    candidate = base
    n = 2
    while candidate in used:
        suffix = f" ({n})"
        candidate = base[: 31 - len(suffix)] + suffix
        n += 1
    used.add(candidate)
    return candidate


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value:.0f}%"


def _style_header(ws: Worksheet) -> None:
    for col_idx, (label, width) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = HEADER_BORDER
        ws.column_dimensions[get_column_letter(col_idx)].width = width
    ws.row_dimensions[1].height = 28


def _write_sheet(ws: Worksheet, rows: list[StudentExamGradeRow]) -> None:
    ws.sheet_view.rightToLeft = True
    _style_header(ws)

    for i, row in enumerate(rows, start=2):
        values = [
            row.full_name or "—",
            row.email,
            row.student_code or "—",
            row.course_grade_level or "—",
            row.course_title,
            row.exam_title,
            f"{row.correct_count}/{row.question_count}" if row.question_count else "—",
            _pct(row.score_percent),
            "ناجح" if row.passed else "راسب",
            _pct(row.month_avg_score_percent),
            _pct(row.chapter_avg_score_percent),
            row.submitted_at.strftime("%Y-%m-%d %H:%M"),
        ]
        base_fill = ROW_ALT_FILL if i % 2 == 0 else None
        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=i, column=col_idx, value=value)
            cell.border = BORDER
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.font = NAME_FONT if col_idx == 1 else BODY_FONT
            if base_fill is not None:
                cell.fill = base_fill
        ws.row_dimensions[i].height = 20

        status_cell = ws.cell(row=i, column=STATUS_COL)
        if row.passed:
            status_cell.fill = PASS_FILL
            status_cell.font = PASS_FONT
        else:
            status_cell.fill = FAIL_FILL
            status_cell.font = FAIL_FONT

    last_row = max(len(rows) + 1, 1)
    last_col = get_column_letter(len(COLUMNS))
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{last_col}{last_row}"


def build_grades_workbook(rows: list[StudentExamGradeRow]) -> bytes:
    """rows -> a ready-to-download .xlsx, one sheet per chapter (course),
    grouped in first-appearance order (matches the mobile dashboard's own
    per-chapter grouping) so the sheet order lines up with what the teacher
    sees on screen."""
    wb = Workbook()
    wb.remove(wb.active)  # drop the default blank sheet

    by_course: dict[str, list[StudentExamGradeRow]] = {}
    course_titles: dict[str, str] = {}
    for row in rows:
        key = str(row.course_id)
        by_course.setdefault(key, []).append(row)
        course_titles[key] = row.course_title

    used_titles: set[str] = set()
    if not by_course:
        # Still hand back a valid (empty) workbook rather than a 500 —
        # a chapter manager with zero completed exam attempts yet.
        ws = wb.create_sheet(_safe_sheet_title("لا توجد بيانات", used_titles))
        _write_sheet(ws, [])
    else:
        for key, course_rows in by_course.items():
            title = _safe_sheet_title(course_titles[key], used_titles)
            ws = wb.create_sheet(title)
            _write_sheet(ws, course_rows)

    from io import BytesIO

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
