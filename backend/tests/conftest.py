"""Test harness — every test runs against a throwaway database, never a real
one.

Two ways to get that database, checked in this order:

1. TEST_DATABASE_URL — use an existing database you created for tests. Its
   name MUST end in "_test" or the run aborts, so a mistyped URL can never
   point the suite at physics_db (or anything else on the same server).
2. Otherwise a brand-new, temporary Postgres cluster is created with the
   local install's own initdb/pg_ctl (found via PG_BIN, then PATH, then
   D:\\PostgreSQL\\bin), started on a free localhost port, and deleted when
   the run ends. It shares nothing with the Postgres service already running
   on this machine.

The schema is built straight from the SQLAlchemy models (create_all), and
every table is emptied after each test.

Run (from backend/):  python -m pytest
"""
import os
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import pytest

_cluster: dict = {}


def _find_pg_bin() -> Path:
    candidates = [os.environ.get("PG_BIN"), shutil.which("initdb") and str(Path(shutil.which("initdb")).parent), r"D:\PostgreSQL\bin"]
    for c in candidates:
        if c and (Path(c) / ("initdb.exe" if os.name == "nt" else "initdb")).exists():
            return Path(c)
    raise RuntimeError("Couldn't find Postgres binaries (initdb). Set PG_BIN or TEST_DATABASE_URL.")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_temp_cluster() -> str:
    pg_bin = _find_pg_bin()
    exe = ".exe" if os.name == "nt" else ""
    data_dir = Path(tempfile.mkdtemp(prefix="physics_pg_test_"))
    port = _free_port()
    subprocess.run(
        [str(pg_bin / f"initdb{exe}"), "-D", str(data_dir), "-U", "tester", "-A", "trust", "-E", "UTF8", "--no-locale"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            str(pg_bin / f"pg_ctl{exe}"),
            "-D", str(data_dir),
            "-o", f"-p {port} -c listen_addresses=127.0.0.1",
            "-l", str(data_dir / "server.log"),
            "-w", "start",
        ],
        check=True,
        # Not capture_output: the server process inherits these handles, so
        # on Windows a captured pipe never closes and the run hangs forever.
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _cluster.update(pg_bin=pg_bin, data_dir=data_dir, exe=exe)

    import psycopg2

    for _ in range(30):
        try:
            conn = psycopg2.connect(host="127.0.0.1", port=port, user="tester", dbname="postgres")
            break
        except psycopg2.OperationalError:
            time.sleep(0.3)
    conn.autocommit = True
    conn.cursor().execute("CREATE DATABASE physics_test")
    conn.close()
    return f"postgresql+psycopg2://tester@127.0.0.1:{port}/physics_test"


def pytest_configure(config):
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        name = url.rsplit("/", 1)[-1].split("?")[0]
        if not name.endswith("_test"):
            raise pytest.UsageError(f"Refusing to run tests against database '{name}' — its name must end in '_test'.")
    else:
        url = _start_temp_cluster()
    # Must be set before anything imports app.core.config.
    os.environ["DATABASE_URL"] = url


def pytest_unconfigure(config):
    if _cluster:
        subprocess.run(
            [str(_cluster["pg_bin"] / f"pg_ctl{_cluster['exe']}"), "-D", str(_cluster["data_dir"]), "-m", "fast", "-w", "stop"],
            capture_output=True,
        )
        shutil.rmtree(_cluster["data_dir"], ignore_errors=True)


@pytest.fixture(scope="session")
def app():
    from app.core.limiter import limiter
    from app.db.database import Base, engine
    from app.main import app as fastapi_app

    assert engine.url.database.endswith("_test"), engine.url
    limiter.enabled = False  # rate limits need Redis; not under test here
    Base.metadata.create_all(engine)
    yield fastapi_app
    engine.dispose()


@pytest.fixture()
def db(app):
    from app.db.database import Base, SessionLocal, engine

    session = SessionLocal()
    yield session
    session.close()
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


# --- factories ---------------------------------------------------------------


@pytest.fixture()
def make_user(db):
    from app.core.security import hash_password
    from app.models.user import User, UserRole

    def _make(role: str = "student", email: str | None = None) -> User:
        user = User(
            email=email or f"{role}-{uuid.uuid4().hex[:8]}@example.test",
            hashed_password=hash_password("password123"),
            full_name=f"Test {role}",
            role=UserRole(role),
            is_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _make


@pytest.fixture()
def auth():
    from app.core.security import create_access_token

    def _headers(user) -> dict:
        return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}

    return _headers


@pytest.fixture()
def course(db):
    """A subject with one course containing three lessons (order 10/20/30)."""
    from app.models.course import Course
    from app.models.lesson import Lesson
    from app.models.subject import Subject

    subject = Subject(name=f"Physics {uuid.uuid4().hex[:6]}")
    db.add(subject)
    db.flush()
    c = Course(subject_id=subject.id, title="Mechanics", order_index=0)
    db.add(c)
    db.flush()
    for i, order in enumerate((10, 20, 30)):
        db.add(Lesson(course_id=c.id, title=f"Lesson {i + 1}", order_index=order, video_url=f"https://example.test/v{i}.mp4"))
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture()
def make_exam(db):
    from app.models.exam import Exam
    from app.models.question import Question

    def _make(course, n_questions: int = 4, order_index: int = 15, **rules) -> Exam:
        exam = Exam(course_id=course.id, title="Exam", order_index=order_index, passing_percent=rules.pop("passing_percent", 50), **rules)
        db.add(exam)
        db.flush()
        for i in range(n_questions):
            db.add(
                Question(
                    exam_id=exam.id,
                    prompt=f"Q{i}",
                    question_type="multiple_choice",
                    choices={"a": "Alpha", "b": "Beta", "c": "Gamma", "d": "Delta"},
                    correct_answer="a",
                    explanation=f"Because {i}",
                )
            )
        db.commit()
        db.refresh(exam)
        return exam

    return _make
