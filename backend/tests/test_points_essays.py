"""Per-question points and teacher-graded essay questions."""
import pytest

from app.models.question import Question

BASE = "/api/v1/exams"


def _set_points(db, exam, points_by_prompt):
    for q in db.query(Question).filter(Question.exam_id == exam.id).all():
        if q.prompt in points_by_prompt:
            q.points = points_by_prompt[q.prompt]
    db.commit()


def _add_essay(db, exam, points=2, prompt="Explain inertia", model="An object keeps its state of motion"):
    q = Question(exam_id=exam.id, prompt=prompt, question_type="essay", correct_answer=model, points=points)
    db.add(q)
    db.commit()
    return q


def _start(client, h, exam):
    r = client.post(f"{BASE}/{exam.id}/start", headers=h)
    assert r.status_code == 200, r.text
    s = r.json()
    return s, {q["prompt"]: q for q in s["questions"]}


def _submit(client, h, s, answers):
    r = client.post(
        f"{BASE}/attempts/{s['attempt_id']}/submit",
        headers=h,
        json={"answers": [{"question_id": qid, "submitted_answer": a} for qid, a in answers.items()]},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_score_is_weighted_by_points(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=2, passing_percent=70)
    _set_points(db, exam, {"Q0": 3, "Q1": 1})
    h = auth(make_user())
    s, by = _start(client, h, exam)
    assert by["Q0"]["points"] == 3 and by["Q1"]["points"] == 1

    res = _submit(client, h, s, {by["Q0"]["id"]: "a", by["Q1"]["id"]: "b"})
    assert (res["earned_points"], res["total_points"]) == (3, 4)
    assert res["score_percent"] == 75.0 and res["passed"] is True


def test_essay_keeps_attempt_pending_and_gate_locked(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, order_index=15)
    essay = _add_essay(db, exam)
    second_lesson = sorted(course.lessons, key=lambda l: l.order_index)[1]
    h = auth(make_user())
    s, by = _start(client, h, exam)

    res = _submit(client, h, s, {by["Q0"]["id"]: "a", str(essay.id): "Things keep moving unless a force acts"})
    assert res["pending_review"] is True
    assert res["score_percent"] is None and res["passed"] is False
    assert res["answers_revealed"] is False
    essay_result = next(a for a in res["answers"] if a["question_id"] == str(essay.id))
    assert essay_result["pending_review"] is True and essay_result["points_awarded"] is None

    status = client.get(f"{BASE}/{exam.id}/status", headers=h).json()
    assert status["history"][0]["pending_review"] is True and status["passed"] is False
    lesson = client.get(f"/api/v1/lessons/{second_lesson.id}", headers=h).json()
    assert lesson["locked_by_exam"] is True


def test_teacher_grades_essay_and_attempt_gets_final_score(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, order_index=15, passing_percent=60)
    essay = _add_essay(db, exam, points=2)
    second_lesson = sorted(course.lessons, key=lambda l: l.order_index)[1]
    student, admin = make_user(), make_user("admin")
    h, ha = auth(student), auth(admin)
    s, by = _start(client, h, exam)
    _submit(client, h, s, {by["Q0"]["id"]: "a", str(essay.id): "Inertia means resistance to change"})

    exams = client.get(f"{BASE}/course/{course.id}", headers=ha).json()
    assert exams[0]["pending_reviews"] == 1 and exams[0]["total_points"] == 3

    queue = client.get(f"{BASE}/{exam.id}/reviews", headers=ha).json()
    assert len(queue) == 1
    item = queue[0]
    assert item["max_points"] == 2 and item["model_answer"].startswith("An object")
    assert item["submitted_answer"] == "Inertia means resistance to change"

    too_many = client.post(f"{BASE}/answers/{item['question_attempt_id']}/review", headers=ha, json={"points_awarded": 3})
    assert too_many.status_code == 400

    r = client.post(
        f"{BASE}/answers/{item['question_attempt_id']}/review",
        headers=ha,
        json={"points_awarded": 1, "comment": "Good start, mention Newton's first law"},
    ).json()
    assert r["attempt_finalized"] is True
    assert round(r["attempt_score_percent"], 2) == round(2 / 3 * 100, 2) and r["attempt_passed"] is True

    assert client.get(f"{BASE}/{exam.id}/reviews", headers=ha).json() == []
    assert len(client.get(f"{BASE}/{exam.id}/reviews?status=reviewed", headers=ha).json()) == 1

    result = client.get(f"{BASE}/attempts/{s['attempt_id']}/result", headers=h).json()
    assert result["pending_review"] is False and result["passed"] is True
    graded = next(a for a in result["answers"] if a["question_id"] == str(essay.id))
    assert graded["points_awarded"] == 1 and graded["teacher_comment"].startswith("Good start")

    lesson = client.get(f"/api/v1/lessons/{second_lesson.id}", headers=h).json()
    assert lesson["locked_by_exam"] is False


def test_regrading_updates_the_score(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, passing_percent=90)
    essay = _add_essay(db, exam, points=1)
    h, ha = auth(make_user()), auth(make_user("admin"))
    s, by = _start(client, h, exam)
    _submit(client, h, s, {by["Q0"]["id"]: "a", str(essay.id): "answer"})
    qa_id = client.get(f"{BASE}/{exam.id}/reviews", headers=ha).json()[0]["question_attempt_id"]

    first = client.post(f"{BASE}/answers/{qa_id}/review", headers=ha, json={"points_awarded": 0}).json()
    assert first["attempt_score_percent"] == 50.0 and first["attempt_passed"] is False
    again = client.post(f"{BASE}/answers/{qa_id}/review", headers=ha, json={"points_awarded": 1}).json()
    assert again["attempt_score_percent"] == 100.0 and again["attempt_passed"] is True
    assert again["attempt_finalized"] is False  # was already final; just re-graded


def test_unanswered_essay_is_zero_not_pending(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=1, passing_percent=40)
    _add_essay(db, exam, points=1)
    h = auth(make_user())
    s, by = _start(client, h, exam)
    res = _submit(client, h, s, {by["Q0"]["id"]: "a"})
    assert res["pending_review"] is False and res["score_percent"] == 50.0


def test_long_essay_answers_are_kept(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=0)
    essay = _add_essay(db, exam)
    h, ha = auth(make_user()), auth(make_user("admin"))
    s, _ = _start(client, h, exam)
    long_answer = "Newton " * 500  # ~3500 chars, over the old 500 limit
    _submit(client, h, s, {str(essay.id): long_answer})
    assert client.get(f"{BASE}/{exam.id}/reviews", headers=ha).json()[0]["submitted_answer"] == long_answer.strip()


def test_students_cannot_grade_or_read_others_results(client, db, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=0)
    essay = _add_essay(db, exam)
    owner, other = make_user(), make_user()
    s, _ = _start(client, auth(owner), exam)
    _submit(client, auth(owner), s, {str(essay.id): "mine"})
    qa_id = client.get(f"{BASE}/{exam.id}/reviews", headers=auth(make_user("admin"))).json()[0]["question_attempt_id"]

    assert client.post(f"{BASE}/answers/{qa_id}/review", headers=auth(owner), json={"points_awarded": 2}).status_code == 403
    assert client.get(f"{BASE}/{exam.id}/reviews", headers=auth(owner)).status_code == 403
    assert client.get(f"{BASE}/attempts/{s['attempt_id']}/result", headers=auth(other)).status_code == 404


def test_essay_questions_only_on_exams(client, make_user, auth, course, make_exam):
    ha = auth(make_user("admin"))
    lesson = sorted(course.lessons, key=lambda l: l.order_index)[0]
    r = client.post(
        "/api/v1/questions",
        headers=ha,
        json={"lesson_id": str(lesson.id), "prompt": "Why?", "question_type": "essay", "correct_answer": ""},
    )
    assert r.status_code == 400

    exam = make_exam(course, n_questions=0)
    r = client.post(
        "/api/v1/questions",
        headers=ha,
        json={"exam_id": str(exam.id), "prompt": "Why?", "question_type": "essay", "correct_answer": "", "points": 3},
    )
    assert r.status_code == 201 and r.json()["points"] == 3
    bad = client.post(
        "/api/v1/questions",
        headers=ha,
        json={"exam_id": str(exam.id), "prompt": "x", "correct_answer": "a", "points": 0},
    )
    assert bad.status_code == 422


@pytest.mark.parametrize("runs", [2])
def test_migration_v19_is_rerunnable(app, runs):
    from app.db.migrate_v19_points_and_essays import migrate

    for _ in range(runs):
        migrate()
