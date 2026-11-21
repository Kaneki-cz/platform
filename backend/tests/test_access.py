"""Who can do what: unauthenticated requests, students vs staff, and the
exam gate that locks lessons until a student passes."""


def test_health_is_public(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_protected_routes_need_a_token(client, course):
    assert client.get("/api/v1/progress").status_code == 401
    assert client.get(f"/api/v1/courses/{course.id}").status_code == 401


def test_garbage_token_is_rejected(client):
    r = client.get("/api/v1/progress", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_students_cannot_manage_exams(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    h = auth(make_user())
    assert client.put(f"/api/v1/exams/{exam.id}", headers=h, json={"title": "Hacked"}).status_code == 403
    assert client.get(f"/api/v1/exams/{exam.id}/attempts", headers=h).status_code == 403
    assert client.delete(f"/api/v1/exams/{exam.id}", headers=h).status_code == 403


def test_instructor_without_linked_course_is_blocked(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    r = client.put(f"/api/v1/exams/{exam.id}", headers=auth(make_user("instructor")), json={"title": "x"})
    assert r.status_code == 403


def _lessons(course):
    return sorted(course.lessons, key=lambda l: l.order_index)


def test_exam_gate_locks_later_lessons_until_passed(client, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, order_index=15)  # sits between lesson 1 and 2
    first, second, _ = _lessons(course)
    h = auth(make_user())

    before = client.get(f"/api/v1/lessons/{first.id}", headers=h).json()
    assert before["locked_by_exam"] is False and before["video_url"]

    locked = client.get(f"/api/v1/lessons/{second.id}", headers=h).json()
    assert locked["locked_by_exam"] is True and locked["video_url"] is None

    s = client.post(f"/api/v1/exams/{exam.id}/start", headers=h).json()
    client.post(
        f"/api/v1/exams/attempts/{s['attempt_id']}/submit",
        headers=h,
        json={"answers": [{"question_id": s["questions"][0]["id"], "submitted_answer": "a"}]},
    )
    unlocked = client.get(f"/api/v1/lessons/{second.id}", headers=h).json()
    assert unlocked["locked_by_exam"] is False and unlocked["video_url"]


def test_staff_are_never_exam_gated(client, make_user, auth, course, make_exam):
    make_exam(course, order_index=15)
    _, second, _ = _lessons(course)
    r = client.get(f"/api/v1/lessons/{second.id}", headers=auth(make_user("admin"))).json()
    assert r["locked_by_exam"] is False


def test_progress_never_goes_backwards(client, make_user, auth, course):
    lesson = _lessons(course)[0]
    h = auth(make_user())
    client.put("/api/v1/progress", headers=h, json={"lesson_id": str(lesson.id), "completion_percent": 80})
    r = client.put("/api/v1/progress", headers=h, json={"lesson_id": str(lesson.id), "completion_percent": 30})
    assert r.json()["completion_percent"] == 80
