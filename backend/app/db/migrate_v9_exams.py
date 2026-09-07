"""One-time migration for the "standalone exams" feature.

Adds:
- exams / exam_attempts (new tables — see app/models/exam.py)
- questions.exam_id (nullable FK to exams.id) + makes questions.lesson_id
  nullable (a question now belongs to EXACTLY ONE of a lesson or an exam —
  see app/models/question.py's docstring)
- question_attempts.exam_attempt_id (nullable FK to exam_attempts.id) —
  groups an exam sitting's answers together for scoring/timing
- lessons.exempt_from_exam_gate (boolean, default false) — the per-lecture
  escape hatch from the exam gate

Safe to run on either an existing or a brand-new database — only adds
what's missing, and is safe to re-run. Independent of the other migrate_v*
scripts — run them in any order, EXCEPT this one must run before any
exam-related endpoint is used (obviously) and creates exams/exam_attempts
before adding the columns that reference them.

Usage:
    python -m app.db.migrate_v9_exams
"""
from sqlalchemy import inspect, text

from app.db.database import Base, engine
from app.models.exam import Exam, ExamAttempt


def _column_exists(table: str, column: str) -> bool:
    inspector = inspect(engine)
    return column in {c["name"] for c in inspector.get_columns(table)}


def _column_nullable(table: str, column: str) -> bool | None:
    inspector = inspect(engine)
    for c in inspector.get_columns(table):
        if c["name"] == column:
            return c["nullable"]
    return None


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    if "lessons" not in tables or "questions" not in tables or "question_attempts" not in tables:
        print("lessons/questions/question_attempts tables don't exist yet — run `python -m app.db.init_db` first.")
        return

    if "exams" not in tables or "exam_attempts" not in tables:
        print("Creating exams / exam_attempts tables ...")
        Base.metadata.create_all(bind=engine, tables=[Exam.__table__, ExamAttempt.__table__])
    else:
        print("exams / exam_attempts tables already present, skipping.")

    if not _column_exists("lessons", "exempt_from_exam_gate"):
        print("Adding lessons.exempt_from_exam_gate ...")
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE lessons ADD COLUMN exempt_from_exam_gate BOOLEAN NOT NULL DEFAULT false")
            )
    else:
        print("lessons.exempt_from_exam_gate already present, skipping.")

    if not _column_exists("questions", "exam_id"):
        print("Adding questions.exam_id ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE questions ADD COLUMN exam_id UUID REFERENCES exams(id)"))
    else:
        print("questions.exam_id already present, skipping.")

    if _column_nullable("questions", "lesson_id") is False:
        print("Making questions.lesson_id nullable ...")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE questions ALTER COLUMN lesson_id DROP NOT NULL"))
    else:
        print("questions.lesson_id already nullable, skipping.")

    if not _column_exists("question_attempts", "exam_attempt_id"):
        print("Adding question_attempts.exam_attempt_id ...")
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE question_attempts ADD COLUMN exam_attempt_id UUID REFERENCES exam_attempts(id)")
            )
    else:
        print("question_attempts.exam_attempt_id already present, skipping.")

    print("Migration complete.")


if __name__ == "__main__":
    migrate()
