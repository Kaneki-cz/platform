"""Teacher exam analytics: overall numbers and per-question difficulty."""


def _take(client, headers, exam, picks):
    """Start and submit an attempt answering the i-th question with
    picks[i] (None = leave unanswered)."""
    s = client.post(f"/api/v1/exams/{exam.id}/start", headers=headers).json()
    by_prompt = {q["prompt"]: q["id"] for q in s["questions"]}
    answers = [
        {"question_id": by_prompt[f"Q{i}"], "submitted_answer": a}
        for i, a in enumerate(picks)
        if a is not None
    ]
    return client.post(f"/api/v1/exams/attempts/{s['attempt_id']}/submit", headers=headers, json={"answers": answers}).json()


def test_analytics_summary_and_hardest_first(client, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=3, passing_percent=60)
    # Q0 easy (both right), Q1 hard (both wrong, same wrong pick), Q2 mixed.
    _take(client, auth(make_user()), exam, ["a", "b", "a"])  # 2/3 -> pass
    _take(client, auth(make_user()), exam, ["a", "b", None])  # 1/3 -> fail

    r = client.get(f"/api/v1/exams/{exam.id}/analytics", headers=auth(make_user("admin")))
    assert r.status_code == 200, r.text
    data = r.json()
    assert (data["attempt_count"], data["student_count"]) == (2, 2)
    assert data["pass_rate"] == 0.5
    assert round(data["average_score"], 1) == 50.0

    prompts = [q["prompt"] for q in data["questions"]]
    assert prompts[0] == "Q1" and prompts[-1] == "Q0"  # hardest first

    hard = data["questions"][0]
    assert hard["correct_rate"] == 0
    assert hard["most_common_wrong"] == {"answer": "b", "label": "Beta", "count": 2}
    assert hard["correct_answer_label"] == "Alpha"
    assert {c["answer"]: c["count"] for c in hard["choice_counts"]} == {"a": 0, "b": 2, "c": 0, "d": 0}

    mixed = next(q for q in data["questions"] if q["prompt"] == "Q2")
    assert (mixed["correct_count"], mixed["answered_count"], mixed["correct_rate"]) == (1, 1, 0.5)


def test_analytics_with_no_attempts(client, make_user, auth, course, make_exam):
    exam = make_exam(course, n_questions=2)
    data = client.get(f"/api/v1/exams/{exam.id}/analytics", headers=auth(make_user("admin"))).json()
    assert data["attempt_count"] == 0 and data["pass_rate"] is None
    assert all(q["correct_rate"] == 0 for q in data["questions"])


def test_students_cannot_see_analytics(client, make_user, auth, course, make_exam):
    exam = make_exam(course)
    assert client.get(f"/api/v1/exams/{exam.id}/analytics", headers=auth(make_user())).status_code == 403
