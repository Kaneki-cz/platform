"""Home-screen summary: per-course progress and the day streak."""
from datetime import timedelta

from app.models.activity import UserActivityDay
from app.services.activity import local_today


def _lessons(course):
    return sorted(course.lessons, key=lambda l: l.order_index)


def test_course_progress_averages_all_lessons(client, make_user, auth, course):
    h = auth(make_user())
    first, second, _ = _lessons(course)
    client.put("/api/v1/progress", headers=h, json={"lesson_id": str(first.id), "completion_percent": 100})
    client.put("/api/v1/progress", headers=h, json={"lesson_id": str(second.id), "completion_percent": 50})

    data = client.get("/api/v1/progress/summary", headers=h).json()
    c = next(x for x in data["courses"] if x["course_id"] == str(course.id))
    assert (c["lesson_count"], c["completed_count"]) == (3, 1)
    assert c["percent"] == 50.0  # (100 + 50 + 0) / 3
    assert data["lessons_completed"] == 1


def test_watching_counts_as_today(client, make_user, auth, course):
    h = auth(make_user())
    assert client.get("/api/v1/progress/summary", headers=h).json()["streak_days"] == 0
    client.put("/api/v1/progress", headers=h, json={"lesson_id": str(_lessons(course)[0].id), "completion_percent": 10})
    data = client.get("/api/v1/progress/summary", headers=h).json()
    assert (data["streak_days"], data["active_today"]) == (1, True)


def test_exam_start_counts_as_activity(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    h = auth(make_user())
    client.post(f"/api/v1/exams/{exam.id}/start", headers=h)
    assert client.get("/api/v1/progress/summary", headers=h).json()["active_today"] is True


def test_streak_counts_consecutive_days_and_survives_until_tonight(client, db, make_user, auth):
    student = make_user()
    today = local_today()
    for back in (1, 2, 3, 5):  # yesterday, 2 and 3 days ago; gap at 4
        db.add(UserActivityDay(user_id=student.id, day=today - timedelta(days=back)))
    db.commit()

    data = client.get("/api/v1/progress/summary", headers=auth(student)).json()
    # Not active yet today, but yesterday keeps the 3-day streak alive.
    assert (data["streak_days"], data["active_today"]) == (3, False)


def test_streak_resets_after_a_missed_day(client, db, make_user, auth):
    student = make_user()
    db.add(UserActivityDay(user_id=student.id, day=local_today() - timedelta(days=2)))
    db.commit()
    assert client.get("/api/v1/progress/summary", headers=auth(student)).json()["streak_days"] == 0


def test_recording_twice_a_day_is_harmless(client, make_user, auth, course):
    h = auth(make_user())
    lesson = _lessons(course)[0]
    for pct in (10, 20, 30):
        assert client.put("/api/v1/progress", headers=h, json={"lesson_id": str(lesson.id), "completion_percent": pct}).status_code == 200
    assert client.get("/api/v1/progress/summary", headers=h).json()["streak_days"] == 1


def test_migration_v18_seeds_from_history(client, db, make_user, auth, course, make_exam):
    """Runs the real migration against the test database: it must skip the
    existing table and seed past activity without duplicating today."""
    from app.db.migrate_v18_activity_streak import migrate

    student = make_user()
    exam = make_exam(course)
    client.post(f"/api/v1/exams/{exam.id}/start", headers=auth(student))
    db.query(UserActivityDay).delete()
    db.commit()

    migrate()
    migrate()  # re-runnable
    days = db.query(UserActivityDay).filter(UserActivityDay.user_id == student.id).all()
    assert [d.day for d in days] == [local_today()]
