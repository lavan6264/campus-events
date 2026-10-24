from datetime import datetime, timedelta, timezone


def test_stats_are_admin_only(client, people, auth_headers):
    assert client.get("/api/admin/stats").status_code == 401
    assert client.get("/api/admin/stats", headers=auth_headers(people["student"])).status_code == 403
    assert client.get("/api/admin/stats", headers=auth_headers(people["faculty"])).status_code == 403
    assert client.get("/api/admin/stats", headers=auth_headers(people["admin"])).status_code == 200


def test_stats_on_an_empty_system_have_a_complete_shape(client, people, auth_headers):
    body = client.get("/api/admin/stats", headers=auth_headers(people["admin"])).json()
    assert body["totals"]["events"] == 0 and body["totals"]["fill_rate"] == 0.0
    assert [c["category"] for c in body["registrations_per_category"]] == [
        "Workshop", "Seminar", "Competition", "Cultural", "Sports", "Club Meet"]
    assert len(body["registrations_per_day"]) == 30
    assert [r["role"] for r in body["registrations_by_role"]] == ["student", "faculty", "admin"]
    assert body["top_events"] == [] and body["near_capacity"] == []


def test_stats_numbers(client, people, auth_headers, make_event, make_registration, make_user):
    now = datetime.now(timezone.utc)
    workshop = make_event(people["faculty"], title="Workshop A", category="Workshop", capacity=4, days=2)
    seminar = make_event(people["faculty"], title="Seminar B", category="Seminar", capacity=10, days=4)
    past = make_event(people["faculty2"], title="Old sports", category="Sports", capacity=10,
                      start=now - timedelta(days=5))
    make_event(people["faculty2"], title="Cancelled one", category="Cultural", capacity=100, status="cancelled")

    extra = [make_user(email=f"x{i}@campus-demo.test") for i in range(4)]
    for person in extra[:3]:
        make_registration(workshop, person, created_at=now - timedelta(days=1))
    make_registration(workshop, people["student"], created_at=now - timedelta(days=1))  # now 4 of 4
    make_registration(workshop, people["student2"], status="waitlisted", created_at=now)
    make_registration(seminar, people["faculty"], created_at=now - timedelta(days=3))
    make_registration(past, people["student"], created_at=now - timedelta(days=9))
    make_registration(past, extra[3], status="cancelled", created_at=now - timedelta(days=9))

    body = client.get("/api/admin/stats", headers=auth_headers(people["admin"])).json()
    totals = body["totals"]
    assert totals["users"] == 9
    assert (totals["events"], totals["published_events"], totals["cancelled_events"]) == (4, 3, 1)
    assert (totals["upcoming_events"], totals["past_events"]) == (2, 1)
    assert (totals["confirmed_registrations"], totals["waitlisted_registrations"],
            totals["cancelled_registrations"]) == (6, 1, 1)
    assert totals["capacity"] == 24  # cancelled event excluded
    assert totals["fill_rate"] == 25.0  # 6 of 24 seats

    cats = {c["category"]: c for c in body["registrations_per_category"]}
    assert cats["Workshop"]["registrations"] == 4 and cats["Workshop"]["fill_rate"] == 100.0
    assert cats["Seminar"]["registrations"] == 1 and cats["Seminar"]["fill_rate"] == 10.0
    assert cats["Cultural"]["events"] == 0  # cancelled events are not counted
    assert cats["Club Meet"]["registrations"] == 0

    assert [e["title"] for e in body["top_events"]] == ["Workshop A", "Old sports", "Seminar B"] or \
        [e["title"] for e in body["top_events"]] == ["Workshop A", "Seminar B", "Old sports"]
    assert body["top_events"][0]["registered"] == 4 and body["top_events"][0]["waitlisted"] == 1
    assert [e["title"] for e in body["near_capacity"]] == ["Workshop A"]

    by_role = {r["role"]: r["registrations"] for r in body["registrations_by_role"]}
    assert by_role == {"student": 5, "faculty": 1, "admin": 0}

    days = {d["date"]: d["registrations"] for d in body["registrations_per_day"]}
    assert days[(now - timedelta(days=1)).date().isoformat()] == 4
    assert days[now.date().isoformat()] == 1
    assert days[(now - timedelta(days=3)).date().isoformat()] == 1
    assert days[(now - timedelta(days=9)).date().isoformat()] == 1  # cancelled one not counted
    assert sum(days.values()) == 7
    assert body["registrations_per_day"][-1]["date"] == now.date().isoformat()


def test_old_registrations_fall_outside_the_30_day_window(client, people, auth_headers, make_event, make_registration):
    now = datetime.now(timezone.utc)
    event = make_event(people["faculty"])
    make_registration(event, people["student"], created_at=now - timedelta(days=45))
    body = client.get("/api/admin/stats", headers=auth_headers(people["admin"])).json()
    assert sum(d["registrations"] for d in body["registrations_per_day"]) == 0
    assert body["totals"]["confirmed_registrations"] == 1


# role changes


def test_admin_changes_a_role(client, people, auth_headers):
    admin = auth_headers(people["admin"])
    url = f"/api/admin/users/{people['student'].id}/role"
    res = client.patch(url, json={"role": "faculty"}, headers=admin)
    assert res.status_code == 200 and res.json()["role"] == "faculty" and "password" not in res.text
    assert client.patch(url, json={"role": "admin"}, headers=admin).json()["role"] == "admin"
    assert client.get("/api/auth/me", headers=auth_headers(people["student"])).json()["role"] == "admin"


def test_role_change_rules(client, people, auth_headers):
    url = f"/api/admin/users/{people['student'].id}/role"
    assert client.patch(url, json={"role": "admin"}).status_code == 401
    assert client.patch(url, json={"role": "admin"}, headers=auth_headers(people["student"])).status_code == 403
    assert client.patch(url, json={"role": "admin"}, headers=auth_headers(people["faculty"])).status_code == 403

    admin = auth_headers(people["admin"])
    assert client.patch(url, json={"role": "superuser"}, headers=admin).status_code == 422
    assert client.patch("/api/admin/users/99999/role", json={"role": "student"}, headers=admin).status_code == 404

    own = client.patch(f"/api/admin/users/{people['admin'].id}/role", json={"role": "student"}, headers=admin)
    assert own.status_code == 403 and own.json() == {"error": "You cannot remove your own admin role"}
    assert client.patch(f"/api/admin/users/{people['admin'].id}/role", json={"role": "admin"}, headers=admin).status_code == 200


def test_users_cannot_promote_themselves_through_the_profile_route(client, people, auth_headers):
    res = client.patch(f"/api/users/{people['student'].id}", json={"role": "admin"}, headers=auth_headers(people["student"]))
    assert res.status_code == 200 and res.json()["role"] == "student"
    res = client.put(f"/api/users/{people['faculty'].id}", json={"role": "admin"}, headers=auth_headers(people["faculty"]))
    assert res.json()["role"] == "faculty"
