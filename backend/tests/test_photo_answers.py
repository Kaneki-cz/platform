"""Essay questions answered with a photo of a handwritten solution."""
import pytest

from app.models.question import Question
from app.services import b2_storage

BASE = "/api/v1/exams"


@pytest.fixture()
def fake_storage(monkeypatch):
    """Pretend R2 is configured; links are recognisable fakes."""
    monkeypatch.setattr(b2_storage, "b2_configured", lambda: True)
    monkeypatch.setattr(b2_storage, "generate_upload_url", lambda key, ct: f"https://upload.test/{key}")
    monkeypatch.setattr(b2_storage, "generate_signed_video_url", lambda key: f"https://view.test/{key}")


def _essay_exam(db, course, make_exam):
    exam = make_exam(course, n_questions=0)
    q = Question(exam_id=exam.id, prompt="Solve on paper", question_type="essay", correct_answer="", points=3)
    db.add(q)
    db.commit()
    return exam, q


def _start(client, h, exam):
    return client.post(f"{BASE}/{exam.id}/start", headers=h).json()


def test_photo_upload_link_is_scoped_to_attempt_and_question(client, db, make_user, auth, course, make_exam, fake_storage):
    exam, q = _essay_exam(db, course, make_exam)
    h = auth(make_user())
    s = _start(client, h, exam)

    r = client.post(f"{BASE}/attempts/{s['attempt_id']}/answer-photo", headers=h, json={"question_id": str(q.id), "file_name": "IMG_1.jpg"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_url"].startswith(f"b2:answers/{s['attempt_id']}/{q.id}-")
    assert body["upload_url"].startswith("https://upload.test/answers/") and body["content_type"] == "image/jpeg"


def test_photo_answer_goes_to_review_with_view_link(client, db, make_user, auth, course, make_exam, fake_storage):
    exam, q = _essay_exam(db, course, make_exam)
    h, ha = auth(make_user()), auth(make_user("admin"))
    s = _start(client, h, exam)
    file_url = client.post(f"{BASE}/attempts/{s['attempt_id']}/answer-photo", headers=h, json={"question_id": str(q.id)}).json()["file_url"]

    # Autosaved photo comes back with a view link on resume.
    client.put(f"{BASE}/attempts/{s['attempt_id']}/draft", headers=h, json={"answers": {str(q.id): file_url}})
    resumed = _start(client, h, exam)
    assert resumed["saved_answer_images"][str(q.id)] == "https://view.test/" + file_url[3:]

    res = client.post(f"{BASE}/attempts/{s['attempt_id']}/submit", headers=h, json={"answers": [{"question_id": str(q.id), "submitted_answer": file_url}]}).json()
    assert res["pending_review"] is True
    assert res["answers"][0]["answer_image_url"] == "https://view.test/" + file_url[3:]

    item = client.get(f"{BASE}/{exam.id}/reviews", headers=ha).json()[0]
    assert item["answer_image_url"] == "https://view.test/" + file_url[3:]
    assert client.post(f"{BASE}/answers/{item['question_attempt_id']}/review", headers=ha, json={"points_awarded": 3}).json()["attempt_passed"] is True


def test_someone_elses_photo_is_not_accepted(client, db, make_user, auth, course, make_exam, fake_storage):
    exam, q = _essay_exam(db, course, make_exam)
    h_a, h_b = auth(make_user()), auth(make_user())
    sa = _start(client, h_a, exam)
    their_photo = client.post(f"{BASE}/attempts/{sa['attempt_id']}/answer-photo", headers=h_a, json={"question_id": str(q.id)}).json()["file_url"]

    sb = _start(client, h_b, exam)
    res = client.post(f"{BASE}/attempts/{sb['attempt_id']}/submit", headers=h_b, json={"answers": [{"question_id": str(q.id), "submitted_answer": their_photo}]}).json()
    assert res["pending_review"] is False  # ignored -> unanswered -> 0
    assert res["score_percent"] == 0


def test_photo_links_rejected_for_wrong_question_type_or_owner(client, db, make_user, auth, course, make_exam, fake_storage):
    exam, q = _essay_exam(db, course, make_exam)
    mc = Question(exam_id=exam.id, prompt="MC", question_type="multiple_choice", choices={"a": "A", "b": "B"}, correct_answer="a")
    db.add(mc)
    db.commit()
    owner = auth(make_user())
    s = _start(client, owner, exam)
    url = f"{BASE}/attempts/{s['attempt_id']}/answer-photo"
    assert client.post(url, headers=owner, json={"question_id": str(mc.id)}).status_code == 400
    assert client.post(url, headers=owner, json={"question_id": str(q.id), "file_name": "x.gif"}).status_code == 400
    assert client.post(url, headers=auth(make_user()), json={"question_id": str(q.id)}).status_code == 404


def test_without_storage_the_upload_says_so(client, db, make_user, auth, course, make_exam, monkeypatch):
    monkeypatch.setattr(b2_storage, "b2_configured", lambda: False)
    exam, q = _essay_exam(db, course, make_exam)
    h = auth(make_user())
    s = _start(client, h, exam)
    r = client.post(f"{BASE}/attempts/{s['attempt_id']}/answer-photo", headers=h, json={"question_id": str(q.id)})
    assert r.status_code == 503
