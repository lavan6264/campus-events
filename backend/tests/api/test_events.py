from datetime import datetime, timedelta, timezone

NEW_EVENT = {
    "title": "Intro to robotics", "description": "Hands on session", "category": "Workshop",
    "venue": "Innovation Lab", "start_time": "2030-05-01T10:00:00Z", "end_time": "2030-05-01T13:00:00Z",
    "capacity": 30,
}


def iso(dt):
    return dt.isoformat()


# create


def test_faculty_creates_event_as_organizer(client, people, auth_headers):
    res = client.post("/api/events/", json=NEW_EVENT, headers=auth_headers(people["faculty"]))
    assert res.status_code == 201
    body = res.json()
    assert body["organizer_id"] == people["faculty"].id and body["organizer_name"] == "Meenakshi Iyer"
    assert body["status"] == "published"
    assert (body["registered_count"], body["waitlisted_count"], body["seats_left"]) == (0, 0, 30)
    assert body["my_status"] is None


def test_organizer_id_in_the_body_is_ignored(client, people, auth_headers):
    res = client.post("/api/events/", json={**NEW_EVENT, "organizer_id": people["admin"].id},
                      headers=auth_headers(people["faculty"]))
    assert res.json()["organizer_id"] == people["faculty"].id


def test_students_cannot_create_events(client, people, auth_headers):
    assert client.post("/api/events/", json=NEW_EVENT, headers=auth_headers(people["student"])).status_code == 403
    assert client.post("/api/events/", json=NEW_EVENT).status_code == 401
    assert client.post("/api/events/", json=NEW_EVENT, headers=auth_headers(people["admin"])).status_code == 201


def test_create_validation(client, people, auth_headers):
    headers = auth_headers(people["faculty"])
    res = client.post("/api/events/", headers=headers, json={
        **NEW_EVENT, "end_time": "2030-05-01T09:00:00Z", "capacity": 0, "category": "Party", "title": ""})
    assert res.status_code == 422
    fields = res.json()["fields"]
    assert set(fields) == {"end_time", "capacity", "category", "title"}
    assert fields["end_time"] == "Must be after the start time"
    assert "Workshop" in fields["category"]


def test_naive_datetimes_are_treated_as_utc(client, people, auth_headers):
    res = client.post("/api/events/", headers=auth_headers(people["faculty"]), json={
        **NEW_EVENT, "start_time": "2030-05-01T10:00:00", "end_time": "2030-05-01T11:00:00"})
    assert res.status_code == 201 and res.json()["start_time"].startswith("2030-05-01T10:00:00")


# update and delete permissions


def test_update_and_delete_permission_matrix(client, people, auth_headers, make_event):
    event = make_event(people["faculty"])
    url = f"/api/events/{event.id}"
    patch = {"title": "Renamed"}

    assert client.patch(url, json=patch, headers=auth_headers(people["student"])).status_code == 403
    assert client.patch(url, json=patch, headers=auth_headers(people["faculty2"])).status_code == 403
    assert client.patch(url, json=patch, headers=auth_headers(people["faculty"])).json()["title"] == "Renamed"
    assert client.put(url, json={"venue": "Main Auditorium"}, headers=auth_headers(people["admin"])).status_code == 200

    assert client.delete(url, headers=auth_headers(people["faculty2"])).status_code == 403
    assert client.delete(url, headers=auth_headers(people["student"])).status_code == 403
    assert client.delete(url, headers=auth_headers(people["faculty"])).status_code == 204
    assert client.get(url, headers=auth_headers(people["admin"])).status_code == 404


def test_admin_can_delete_any_event(client, people, auth_headers, make_event):
    event = make_event(people["faculty"])
    assert client.delete(f"/api/events/{event.id}", headers=auth_headers(people["admin"])).status_code == 204


def test_update_cannot_make_end_before_start(client, people, auth_headers, make_event):
    event = make_event(people["faculty"], days=3, hours=2)
    bad_end = iso(event.start_time - timedelta(hours=1))
    res = client.patch(f"/api/events/{event.id}", json={"end_time": bad_end.replace("+00:00", "Z")},
                       headers=auth_headers(people["faculty"]))
    assert res.status_code == 422 and res.json()["fields"] == {"end_time": "Must be after the start time"}


def test_event_can_be_cancelled(client, people, auth_headers, make_event):
    event = make_event(people["faculty"])
    res = client.patch(f"/api/events/{event.id}", json={"status": "cancelled"}, headers=auth_headers(people["faculty"]))
    assert res.json()["status"] == "cancelled"
    assert client.patch(f"/api/events/{event.id}", json={"status": "archived"},
                        headers=auth_headers(people["faculty"])).status_code == 422


# capacity rules


def test_capacity_cannot_drop_below_confirmed_registrations(client, people, auth_headers, make_event, make_registration, make_user):
    event = make_event(people["faculty"], capacity=5)
    for i in range(3):
        make_registration(event, make_user(email=f"p{i}@campus-demo.test"))
    headers = auth_headers(people["faculty"])
    res = client.patch(f"/api/events/{event.id}", json={"capacity": 2}, headers=headers)
    assert res.status_code == 422
    assert res.json()["fields"]["capacity"] == "Must be at least 3 (confirmed registrations)"
    assert client.patch(f"/api/events/{event.id}", json={"capacity": 3}, headers=headers).status_code == 200


def test_waitlisted_registrations_do_not_block_lowering_capacity(client, people, auth_headers, make_event, make_registration):
    event = make_event(people["faculty"], capacity=1)
    make_registration(event, people["student"])
    make_registration(event, people["student2"], status="waitlisted")
    assert client.patch(f"/api/events/{event.id}", json={"capacity": 1}, headers=auth_headers(people["faculty"])).status_code == 200


def test_raising_capacity_promotes_the_oldest_waitlisted_first(
        client, people, auth_headers, make_event, make_registration, make_user, session_factory):
    from app.resources.registrations.models import Registration

    event = make_event(people["faculty"], capacity=1)
    now = datetime.now(timezone.utc)
    make_registration(event, people["student"], created_at=now - timedelta(hours=5))
    late = make_user(email="late@campus-demo.test")
    early = make_user(email="early@campus-demo.test")
    make_registration(event, late, status="waitlisted", created_at=now - timedelta(hours=1))
    make_registration(event, early, status="waitlisted", created_at=now - timedelta(hours=3))

    res = client.patch(f"/api/events/{event.id}", json={"capacity": 2}, headers=auth_headers(people["faculty"]))
    assert res.status_code == 200
    assert (res.json()["registered_count"], res.json()["waitlisted_count"], res.json()["seats_left"]) == (2, 1, 0)

    with session_factory() as db:
        status = {r.user_id: r.status for r in db.query(Registration).filter_by(event_id=event.id)}
    assert status[early.id] == "registered" and status[late.id] == "waitlisted"


# computed fields


def test_computed_fields_for_the_current_user(client, people, auth_headers, make_event, make_registration, make_user):
    event = make_event(people["faculty"], capacity=2)
    make_registration(event, people["student"])
    make_registration(event, make_user(email="x@campus-demo.test"))
    now = datetime.now(timezone.utc)
    make_registration(event, make_user(email="w1@campus-demo.test"), status="waitlisted", created_at=now - timedelta(hours=2))
    make_registration(event, people["student2"], status="waitlisted", created_at=now - timedelta(hours=1))
    make_registration(event, make_user(email="c@campus-demo.test"), status="cancelled")

    mine = client.get(f"/api/events/{event.id}", headers=auth_headers(people["student"])).json()
    assert (mine["registered_count"], mine["waitlisted_count"], mine["seats_left"]) == (2, 2, 0)
    assert mine["my_status"] == "registered" and mine["my_waitlist_position"] is None

    waiting = client.get(f"/api/events/{event.id}", headers=auth_headers(people["student2"])).json()
    assert waiting["my_status"] == "waitlisted" and waiting["my_waitlist_position"] == 2

    outsider = client.get(f"/api/events/{event.id}", headers=auth_headers(people["admin"])).json()
    assert outsider["my_status"] is None


def test_clash_notice_is_computed_against_confirmed_events_only(
        client, people, auth_headers, make_event, make_registration):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=4)
    confirmed = make_event(people["faculty"], title="Confirmed one", start=base, hours=3)
    overlapping = make_event(people["faculty2"], title="Overlapping", start=base + timedelta(hours=1), hours=2)
    later = make_event(people["faculty2"], title="Later", start=base + timedelta(hours=5), hours=1)
    make_registration(confirmed, people["student"])

    headers = auth_headers(people["student"])
    over = client.get(f"/api/events/{overlapping.id}", headers=headers).json()
    assert over["clash_with_title"] == "Confirmed one" and over["clash_with_id"] == confirmed.id
    assert client.get(f"/api/events/{later.id}", headers=headers).json()["clash_with_title"] is None
    assert client.get(f"/api/events/{confirmed.id}", headers=headers).json()["clash_with_title"] is None

    # A waitlisted registration never blocks, so it produces no notice for other events.
    make_registration(overlapping, people["student2"], status="waitlisted")
    other = auth_headers(people["student2"])
    assert client.get(f"/api/events/{confirmed.id}", headers=other).json()["clash_with_title"] is None


# list, filters, search


def test_events_list_filters(client, people, auth_headers, make_event):
    now = datetime.now(timezone.utc)
    make_event(people["faculty"], title="Robotics workshop", category="Workshop", days=2)
    make_event(people["faculty"], title="Football league", category="Sports", venue="Sports Ground", days=5)
    make_event(people["faculty2"], title="Law seminar", category="Seminar", days=10)
    make_event(people["faculty2"], title="Old quiz", category="Competition", start=now - timedelta(days=6))
    make_event(people["faculty2"], title="Called off", category="Cultural", days=4, status="cancelled")
    headers = auth_headers(people["student"])

    def titles(query):
        res = client.get(f"/api/events/?limit=50&{query}", headers=headers)
        assert res.status_code == 200, res.text
        return [e["title"] for e in res.json()["items"]]

    assert len(titles("")) == 5
    assert titles("sort=start_time")[0] == "Old quiz"
    assert "Old quiz" not in titles("upcoming=true")
    assert titles("upcoming=false") == ["Old quiz"]
    assert titles("category=Sports") == ["Football league"]
    assert set(titles("category__in=Sports,Seminar")) == {"Football league", "Law seminar"}
    assert titles("status=cancelled") == ["Called off"]
    assert "Called off" not in titles("status__in=published")
    assert titles("q=ROBOTICS") == ["Robotics workshop"]
    assert titles("venue=Sports Ground") == ["Football league"]
    assert set(titles("organizer=arvind")) == {"Law seminar", "Old quiz", "Called off"}
    assert set(titles(f"organizer={people['faculty'].id}")) == {"Robotics workshop", "Football league"}

    lo = (now + timedelta(days=3)).isoformat().replace("+00:00", "Z")
    hi = (now + timedelta(days=6)).isoformat().replace("+00:00", "Z")
    assert set(titles(f"start_time__gte={lo}&start_time__lte={hi}")) == {"Called off", "Football league"}


def test_events_list_sort_pagination_and_whitelists(client, people, auth_headers, make_event):
    for i in range(7):
        make_event(people["faculty"], title=f"Event {i}", days=i + 1)
    headers = auth_headers(people["student"])
    page = client.get("/api/events/?page=2&limit=3&sort=-start_time", headers=headers).json()
    assert (page["total"], page["pages"], page["page"]) == (7, 3, 2)
    assert [e["title"] for e in page["items"]] == ["Event 3", "Event 2", "Event 1"]
    assert client.get("/api/events/?sort=organizer_id", headers=headers).status_code == 400
    assert client.get("/api/events/?organizer_id=1", headers=headers).status_code == 400
    assert client.get("/api/events/?upcoming=soon", headers=headers).status_code == 400
    assert client.get("/api/events/", headers={}).status_code == 401


def test_event_routes_documented_with_filters(client):
    spec = client.get("/openapi.json").json()["paths"]
    params = {p["name"] for p in spec["/api/events/"]["get"]["parameters"]}
    assert {"organizer", "upcoming", "start_time__gte", "start_time__lte", "category", "status__in", "q"} <= params
    assert set(spec["/api/events/{id}"]) == {"get", "put", "patch", "delete"}
