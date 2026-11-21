"""Student exam flow end to end: start, autosave, resume, submit, limits,
time limit, answer reveal — all through the real HTTP API and database."""
from datetime import timedelta

from app.models.exam import ExamAttempt

BASE = "/api/v1/exams"


def _start(client, headers, exam):
    r = client.post(f"{BASE}/{exam.id}/start", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _answer_all(questions, answer="a"):
    return [{"question_id": q["id"], "submitted_answer": answer} for q in questions]


def test_start_returns_shuffled_layout_and_resume_keeps_it(client, db, make_user, auth, course, make_exam):
    student = make_user()
    exam = make_exam(course, n_questions=6)
    h = auth(student)

    first = _start(client, h, exam)
    ids = [q["id"] for q in first["questions"]]
    assert len(ids) == 6
    assert all(sorted(q["choice_order"]) == ["a", "b", "c", "d"] for q in first["questions"])

    again = _start(client, h, exam)
    assert again["attempt_id"] == first["attempt_id"]
    assert [q["id"] for q in again["questions"]] == ids
    assert db.query(ExamAttempt).count() == 1


def test_questions_never_leak_answers_to_students(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    body = _start(client, auth(make_user()), exam)
    for q in body["questions"]:
        assert "correct_answer" not in q and "explanation" not in q


def test_draft_autosave_is_restored_on_resume(client, make_user, auth, course, make_exam):
    student = make_user()
    exam = make_exam(course)
    h = auth(student)
    s = _start(client, h, exam)
    q0, q1 = s["questions"][0]["id"], s["questions"][1]["id"]

    r = client.put(
        f"{BASE}/attempts/{s['attempt_id']}/draft",
        headers=h,
        json={"answers": {q0: "b"}, "flagged_question_ids": [q1]},
    )
    assert r.status_code == 204

    resumed = _start(client, h, exam)
    assert resumed["saved_answers"] == {q0: "b"}
    assert resumed["flagged_question_ids"] == [q1]


def test_failed_attempt_hides_answers_partial_counts_wrong(client, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=4, passing_percent=75)
    h = auth(make_user())
    s = _start(client, h, exam)
    one = [{"question_id": s["questions"][0]["id"], "submitted_answer": "a"}]

    r = client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=h, json={"answers": one})
    assert r.status_code == 200
    res = r.json()
    assert (res["correct_count"], res["total_count"], res["passed"]) == (1, 4, False)
    assert res["answers_revealed"] is False
    assert all(a["correct_answer"] is None and a["explanation"] is None for a in res["answers"])


def test_passed_attempt_reveals_answers(client, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=2)
    h = auth(make_user())
    s = _start(client, h, exam)
    res = client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=h, json={"answers": _answer_all(s["questions"], " A ")}).json()
    assert res["passed"] and res["answers_revealed"]
    assert res["answers"][0]["correct_answer"] == "a"


def test_teacher_can_opt_in_to_showing_answers_on_fail(client, make_user, auth, course, make_exam):
    exam = make_exam(course, show_answers_on_fail=True)
    h = auth(make_user())
    s = _start(client, h, exam)
    res = client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=h, json={"answers": []}).json()
    assert not res["passed"] and res["answers_revealed"]


def test_double_submit_is_rejected(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    h = auth(make_user())
    s = _start(client, h, exam)
    url = f"{BASE}/attempts/{s['attempt_id']}/submit"
    assert client.post(url, headers=h, json={"answers": []}).status_code == 200
    assert client.post(url, headers=h, json={"answers": []}).status_code == 409


def test_cannot_submit_someone_elses_attempt(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    s = _start(client, auth(make_user()), exam)
    r = client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=auth(make_user()), json={"answers": []})
    assert r.status_code == 404


def test_cooldown_then_max_attempts(client, db, make_user, auth, course, make_exam):
    student = make_user()
    exam = make_exam(course, n_questions=1, max_attempts=2, retake_cooldown_minutes=60)
    h = auth(student)

    s = _start(client, h, exam)
    client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=h, json={"answers": []})
    status = client.get(f"{BASE}/{exam.id}/status", headers=h).json()
    assert status["can_start"] is False and status["blocked_reason"] == "cooldown"
    assert status["next_attempt_at"] is not None
    r = client.post(f"{BASE}/{exam.id}/start", headers=h)
    assert r.status_code == 403 and r.json()["detail"] == "cooldown"

    # Let the cooldown pass, take the 2nd (last) attempt.
    for a in db.query(ExamAttempt).all():
        a.submitted_at -= timedelta(minutes=61)
    db.commit()
    s2 = _start(client, h, exam)
    client.post(f"{BASE}/attempts/{s2['attempt_id']}/submit", headers=h, json={"answers": []})
    for a in db.query(ExamAttempt).all():
        a.submitted_at -= timedelta(minutes=61)
    db.commit()

    status = client.get(f"{BASE}/{exam.id}/status", headers=h).json()
    assert status["blocked_reason"] == "max_attempts"
    assert (status["attempts_used"], status["attempts_remaining"]) == (2, 0)
    assert len(status["history"]) == 2


def test_time_limit_auto_submits_from_draft(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=2, time_limit_minutes=10)
    h = auth(make_user())
    s = _start(client, h, exam)
    assert s["time_limit_seconds"] == 600 and s["expires_at"]
    q0 = s["questions"][0]["id"]
    client.put(f"{BASE}/attempts/{s['attempt_id']}/draft", headers=h, json={"answers": {q0: "a"}})

    attempt = db.get(ExamAttempt, s["attempt_id"])
    attempt.started_at -= timedelta(minutes=11)
    db.commit()

    # A late submit claiming everything right is ignored — the draft counts.
    res = client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=h, json={"answers": _answer_all(s["questions"])}).json()
    assert res["auto_submitted"] is True
    assert res["correct_count"] == 1
    assert res["duration_seconds"] <= 600


def test_status_closes_overdue_attempt(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, time_limit_minutes=5)
    h = auth(make_user())
    s = _start(client, h, exam)
    attempt = db.get(ExamAttempt, s["attempt_id"])
    attempt.started_at -= timedelta(minutes=7)
    db.commit()

    status = client.get(f"{BASE}/{exam.id}/status", headers=h).json()
    assert status["in_progress_attempt_id"] is None
    assert status["history"][0]["auto_submitted"] is True


def test_late_draft_returns_time_up(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, time_limit_minutes=5)
    h = auth(make_user())
    s = _start(client, h, exam)
    attempt = db.get(ExamAttempt, s["attempt_id"])
    attempt.started_at -= timedelta(minutes=6)
    db.commit()
    r = client.put(f"{BASE}/attempts/{s['attempt_id']}/draft", headers=h, json={"answers": {}})
    assert r.status_code == 409 and r.json()["detail"] == "time_up"


def test_admin_can_set_and_clear_rules(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    h = auth(make_user("admin"))
    r = client.put(f"{BASE}/{exam.id}", headers=h, json={"time_limit_minutes": 20, "max_attempts": 3, "shuffle_choices": False})
    assert r.status_code == 200
    body = r.json()
    assert (body["time_limit_minutes"], body["max_attempts"], body["shuffle_choices"]) == (20, 3, False)

    r = client.put(f"{BASE}/{exam.id}", headers=h, json={"time_limit_minutes": None})
    assert r.json()["time_limit_minutes"] is None
    assert r.json()["max_attempts"] == 3  # untouched fields stay

    assert client.put(f"{BASE}/{exam.id}", headers=h, json={"max_attempts": 0}).status_code == 422
