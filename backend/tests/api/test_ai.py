from datetime import date, datetime, timedelta, timezone

import pytest

from app.ai.search import fallback_filters
from app.ai.summary import only_known_numbers

PICK = {"event_id": 0, "reason": "x"}


# natural language search


def test_search_uses_the_model_and_returns_event_list_filters(client, people, auth_headers, fake_ai, make_event):
    fake_ai.reply({"q": "robotics", "category": "workshop", "start_date": "2030-05-06", "end_date": "2030-05-12"})
    res = client.post("/api/ai/search", json={"query": "robotics workshops next week"},
                      headers=auth_headers(people["student"]))
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "ai"
    assert body["filters"] == {
        "q": "robotics", "category": "Workshop",
        "start_time__gte": "2030-05-06T00:00:00+00:00", "start_time__lte": "2030-05-12T23:59:59+00:00",
    }
    assert body["summary"] == 'Showing Workshop events matching "robotics" from 06 May to 12 May'

    # The model's prompt carries today's date and the real categories.
    assert date.today().isoformat() in fake_ai.prompt or datetime.now(timezone.utc).date().isoformat() in fake_ai.prompt
    assert "Workshop, Seminar, Competition, Cultural, Sports, Club Meet" in fake_ai.prompt

    # And the output feeds straight into the CRUD list endpoint.
    start = datetime(2030, 5, 8, 10, tzinfo=timezone.utc)
    make_event(people["faculty"], title="Robotics lab session", category="Workshop", start=start)
    make_event(people["faculty"], title="Robotics lab session two", category="Seminar", start=start)
    listing = client.get("/api/events/", params=body["filters"], headers=auth_headers(people["student"]))
    assert listing.status_code == 200
    assert [e["title"] for e in listing.json()["items"]] == ["Robotics lab session"]


def test_search_drops_what_it_cannot_validate(client, people, auth_headers, fake_ai):
    fake_ai.reply({"q": "  ", "category": "Parties", "start_date": "next tuesday", "end_date": "2030-05-12"})
    body = client.post("/api/ai/search", json={"query": "parties"}, headers=auth_headers(people["student"])).json()
    assert body["source"] == "ai"
    assert body["filters"] == {"start_time__lte": "2030-05-12T23:59:59+00:00"}


def test_search_swaps_reversed_dates_and_ignores_absurd_ones(client, people, auth_headers, fake_ai):
    headers = auth_headers(people["student"])
    fake_ai.reply({"start_date": "2030-05-12", "end_date": "2030-05-06"})
    filters = client.post("/api/ai/search", json={"query": "x"}, headers=headers).json()["filters"]
    assert filters["start_time__gte"].startswith("2030-05-06") and filters["start_time__lte"].startswith("2030-05-12")
    fake_ai.reply({"start_date": "1999-01-01", "end_date": "2999-01-01"})
    assert client.post("/api/ai/search", json={"query": "x"}, headers=headers).json()["filters"] == {}


@pytest.mark.parametrize("failure", ["error", "timeout", "bad_json", "wrong_shape"])
def test_search_falls_back_when_the_model_fails(client, people, auth_headers, fake_ai, failure):
    if failure == "error":
        fake_ai.fail()
    elif failure == "timeout":
        fake_ai.fail(TimeoutError("deadline exceeded"))
    elif failure == "bad_json":
        fake_ai.reply("this is not json")
    else:
        fake_ai.reply({"q": ["not", "a", "string"]})
    res = client.post("/api/ai/search", json={"query": "robotics workshops next week"},
                      headers=auth_headers(people["student"]))
    assert res.status_code == 200
    assert res.json()["source"] == "fallback" and res.json()["filters"] == {"q": "robotic", "category": "Workshop"}


def test_search_without_an_api_key_uses_the_fallback(client, people, auth_headers):
    res = client.post("/api/ai/search", json={"query": "coding contest"}, headers=auth_headers(people["student"]))
    assert res.json()["source"] == "fallback" and res.json()["filters"] == {"q": "coding", "category": "Competition"}


@pytest.mark.parametrize("query,expected", [
    ("robotics workshops next week", {"q": "robotic", "category": "Workshop"}),
    ("free coding events on weekends", {"q": "coding"}),
    ("upcoming events", {}),
    ("football matches", {"q": "football", "category": "Sports"}),
    ("Club Meet photography", {"q": "photography", "category": "Club Meet"}),
    ("seminars about quantum computing", {"q": "computing", "category": "Seminar"}),
])
def test_keyword_fallback(query, expected):
    assert fallback_filters(query) == expected


def test_search_input_and_access_rules(client, people, auth_headers, fake_ai):
    assert client.post("/api/ai/search", json={"query": "x"}).status_code == 401
    headers = auth_headers(people["student"])
    assert client.post("/api/ai/search", json={"query": ""}, headers=headers).status_code == 422
    assert client.post("/api/ai/search", json={"query": "x" * 301}, headers=headers).status_code == 422
    assert fake_ai.calls == []  # invalid requests never reach the model


def test_ai_endpoints_are_rate_limited(client, people, auth_headers):
    headers = auth_headers(people["student"])
    codes = [client.post("/api/ai/search", json={"query": "robotics"}, headers=headers).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429]
    assert client.post("/api/ai/search", json={"query": "robotics"},
                       headers=auth_headers(people["student2"])).status_code == 200


# draft assistant


def test_draft_with_the_model(client, people, auth_headers, fake_ai):
    fake_ai.reply({"title": "Intro to robotics", "category": "workshop",
                   "description": "A hands on session. Bring a laptop. No experience needed."})
    res = client.post("/api/ai/draft-event", json={"notes": "robotics session friday lab bring laptop"},
                      headers=auth_headers(people["faculty"]))
    assert res.status_code == 200
    assert res.json() == {"source": "ai", "title": "Intro to robotics", "category": "Workshop",
                          "description": "A hands on session. Bring a laptop. No experience needed."}
    assert "robotics session friday lab bring laptop" in fake_ai.prompt


def test_draft_rejects_an_unknown_category_but_keeps_the_text(client, people, auth_headers, fake_ai):
    fake_ai.reply({"title": "Party", "category": "Party", "description": "Fun."})
    body = client.post("/api/ai/draft-event", json={"notes": "party"}, headers=auth_headers(people["admin"])).json()
    assert body["source"] == "ai" and body["category"] is None and body["title"] == "Party"


@pytest.mark.parametrize("failure", ["error", "empty_title", "bad_json"])
def test_draft_fallback_keeps_the_notes_as_the_description(client, people, auth_headers, fake_ai, failure):
    if failure == "error":
        fake_ai.fail(TimeoutError())
    elif failure == "empty_title":
        fake_ai.reply({"title": "  ", "description": "Something", "category": "Workshop"})
    else:
        fake_ai.reply("{")
    res = client.post("/api/ai/draft-event", json={"notes": "  robotics talk on friday  "},
                      headers=auth_headers(people["faculty"]))
    assert res.json() == {"source": "fallback", "title": "", "description": "robotics talk on friday", "category": None}


def test_draft_is_for_organizers_and_saves_nothing(client, people, auth_headers, fake_ai):
    fake_ai.reply({"title": "T", "description": "D", "category": "Seminar"})
    assert client.post("/api/ai/draft-event", json={"notes": "x"}).status_code == 401
    assert client.post("/api/ai/draft-event", json={"notes": "x"}, headers=auth_headers(people["student"])).status_code == 403
    assert client.post("/api/ai/draft-event", json={"notes": "x"}, headers=auth_headers(people["faculty"])).status_code == 200
    assert client.get("/api/events/", headers=auth_headers(people["admin"])).json()["total"] == 0


# recommendations


@pytest.fixture()
def catalogue(people, make_event, make_registration, make_user):
    """Student joined a Workshop in the past. Upcoming: popular Sports, two Workshops."""
    past = make_event(people["faculty"], title="Earlier workshop", category="Workshop", days=-10)
    make_registration(past, people["student"])
    crowd = [make_user(email=f"c{i}@campus-demo.test") for i in range(6)]
    sports = make_event(people["faculty2"], title="Football league", category="Sports", days=3)
    popular_ws = make_event(people["faculty"], title="Data science workshop", category="Workshop", days=4)
    quiet_ws = make_event(people["faculty"], title="Poetry workshop", category="Workshop", days=5)
    already = make_event(people["faculty"], title="Already joined seminar", category="Seminar", days=6)
    for person in crowd:
        make_registration(sports, person)
    for person in crowd[:2]:
        make_registration(popular_ws, person)
    make_registration(already, people["student"])
    return {"sports": sports, "popular_ws": popular_ws, "quiet_ws": quiet_ws, "already": already}


def test_recommendations_from_the_model(client, people, auth_headers, fake_ai, catalogue):
    ids = catalogue
    fake_ai.reply({"picks": [
        {"event_id": ids["quiet_ws"].id, "reason": "You joined a workshop before."},
        {"event_id": 987654, "reason": "Not a real event."},
        {"event_id": ids["quiet_ws"].id, "reason": "Duplicate."},
        {"event_id": ids["sports"].id, "reason": "Popular with other students."},
    ]})
    res = client.get("/api/ai/recommendations", headers=auth_headers(people["student"]))
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "ai"
    assert [(i["event"]["title"], i["reason"]) for i in body["items"]] == [
        ("Poetry workshop", "You joined a workshop before."),
        ("Football league", "Popular with other students."),
    ]
    assert body["items"][0]["event"]["seats_left"] == 10

    # The prompt has history and candidates only: no personal details, no events already joined.
    prompt = fake_ai.prompt
    assert "Earlier workshop" in prompt and "Poetry workshop" in prompt
    assert "Already joined seminar: " not in prompt and "id %d:" % ids["already"].id not in prompt
    for private in ("Aarav", "student@campus-demo.test", "password"):
        assert private not in prompt


def test_recommendations_fallback_prefers_joined_categories_then_popularity(
        client, people, auth_headers, fake_ai, catalogue):
    fake_ai.fail()
    body = client.get("/api/ai/recommendations", headers=auth_headers(people["student"])).json()
    assert body["source"] == "fallback"
    assert [i["event"]["title"] for i in body["items"]] == ["Data science workshop", "Poetry workshop", "Football league"]
    assert body["items"][0]["reason"] == "Popular Workshop event, a category you have joined before"
    assert body["items"][2]["reason"] == "Popular on campus right now, 6 registered"
    assert all(i["event"]["my_status"] is None for i in body["items"])


def test_recommendations_fall_back_when_every_pick_is_invalid(client, people, auth_headers, fake_ai, catalogue):
    fake_ai.reply({"picks": [{"event_id": 555555, "reason": "Made up."}]})
    assert client.get("/api/ai/recommendations", headers=auth_headers(people["student"])).json()["source"] == "fallback"


def test_recommendations_with_no_history_use_overall_popularity(client, people, auth_headers, catalogue):
    body = client.get("/api/ai/recommendations", headers=auth_headers(people["student2"])).json()
    assert body["source"] == "fallback"
    assert body["items"][0]["event"]["title"] == "Football league"


def test_recommendations_with_nothing_upcoming(client, people, auth_headers, fake_ai):
    body = client.get("/api/ai/recommendations", headers=auth_headers(people["student"])).json()
    assert body == {"source": "fallback", "items": []}
    assert fake_ai.calls == []
    assert client.get("/api/ai/recommendations").status_code == 401


# admin summary


@pytest.fixture()
def busy_system(people, make_event, make_registration, make_user):
    now = datetime.now(timezone.utc)
    near = make_event(people["faculty"], title="Almost full workshop", category="Workshop", capacity=4, days=2)
    make_event(people["faculty"], title="Quiet seminar", category="Seminar", capacity=50, days=3)
    for i in range(4):
        make_registration(near, make_user(email=f"s{i}@campus-demo.test"), created_at=now - timedelta(days=i))
    make_registration(near, people["student"], status="waitlisted")


GOOD = [
    "There are 4 confirmed registrations across 2 published events.",
    "Almost full workshop is at 100.0% of its 4 seats.",
    "Registrations are growing, with 5 in the last 7 days against 0 in the 7 days before.",
    "Seminar is the least used category at 0.0% of seats filled.",
]


def test_summary_is_admin_only(client, people, auth_headers):
    assert client.get("/api/admin/ai/summary").status_code == 401
    assert client.get("/api/admin/ai/summary", headers=auth_headers(people["faculty"])).status_code == 403
    assert client.get("/api/admin/ai/summary", headers=auth_headers(people["admin"])).status_code == 200


def test_summary_from_the_model(client, people, auth_headers, fake_ai, busy_system):
    fake_ai.reply({"sentences": GOOD})
    body = client.get("/api/admin/ai/summary", headers=auth_headers(people["admin"])).json()
    assert body["source"] == "ai" and body["sentences"] == GOOD and body["summary"] == " ".join(GOOD)
    assert "Almost full workshop" in fake_ai.prompt and "registrations_last_7_days" in fake_ai.prompt
    assert "@" not in fake_ai.prompt  # no emails


@pytest.mark.parametrize("reply", [
    {"sentences": GOOD[:3]},  # too few sentences
    {"sentences": GOOD + ["Extra one.", "Another extra one."]},  # too many
    {"sentences": GOOD[:3] + ["Registrations rose by 73 percent."]},  # a number not in the stats
])
def test_summary_rejects_replies_that_break_the_rules(client, people, auth_headers, fake_ai, busy_system, reply):
    fake_ai.reply(reply)
    assert client.get("/api/admin/ai/summary", headers=auth_headers(people["admin"])).json()["source"] == "fallback"


def test_summary_fallback_is_built_from_the_same_numbers(client, people, auth_headers, fake_ai, busy_system):
    fake_ai.fail(TimeoutError())
    body = client.get("/api/admin/ai/summary", headers=auth_headers(people["admin"])).json()
    assert body["source"] == "fallback"
    assert 3 <= len(body["sentences"]) <= 5
    text = body["summary"]
    assert "4 confirmed registrations across 2 published events" in text
    assert "Registrations are growing: 5 in the last 7 days against 0" in text
    assert "Almost full workshop (100% full)" in text
    assert "No events are scheduled in Competition, Cultural, Sports, Club Meet" in text


def test_summary_fallback_with_no_data(client, people, auth_headers):
    body = client.get("/api/admin/ai/summary", headers=auth_headers(people["admin"])).json()
    assert body["source"] == "fallback" and "No upcoming event is near capacity." in body["sentences"]


def test_number_guard():
    payload = {"totals": {"events": 20, "fill_rate": 42.5}, "list": [3, 7]}
    assert only_known_numbers(["20 events, 42.5 percent full, 3 and 7 in the last 7 days."], payload)
    assert not only_known_numbers(["21 events."], payload)
    assert only_known_numbers(["No numbers here at all."], payload)


# the 5 second limit


def test_a_slow_model_is_abandoned_and_the_fallback_answers(client, people, auth_headers, fake_ai, monkeypatch):
    import time

    monkeypatch.setattr("app.ai.client.TIMEOUT_SECONDS", 0.2)
    original = fake_ai.generate_content
    fake_ai.reply({"q": "robotics"})
    fake_ai.generate_content = lambda **kw: (time.sleep(1.0), original(**kw))[1]

    started = time.monotonic()
    res = client.post("/api/ai/search", json={"query": "coding contest"}, headers=auth_headers(people["student"]))
    assert time.monotonic() - started < 0.9
    assert res.json()["source"] == "fallback" and res.json()["filters"]["q"] == "coding"
    time.sleep(1.0)  # let the abandoned call finish and free its slot


def test_a_stalled_api_cannot_use_up_all_threads(client, people, auth_headers, fake_ai, monkeypatch):
    import threading

    from app.ai import client as ai_client

    # Pretend every slot is held by a call that never returns.
    held = [ai_client._slots.acquire(blocking=False) for _ in range(ai_client.MAX_IN_FLIGHT)]
    try:
        fake_ai.reply({"q": "robotics"})
        res = client.post("/api/ai/search", json={"query": "coding contest"}, headers=auth_headers(people["student"]))
        assert res.json()["source"] == "fallback"
        assert fake_ai.calls == []  # not even attempted
    finally:
        for ok in held:
            if ok:
                ai_client._slots.release()
