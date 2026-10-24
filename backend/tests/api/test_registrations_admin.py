from datetime import datetime, timedelta, timezone


def test_only_admin_can_list_or_read_registrations(client, people, auth_headers, make_event, make_registration):
    event = make_event(people["faculty"])
    reg = make_registration(event, people["student"])

    assert client.get("/api/registrations/", headers=auth_headers(people["student"])).status_code == 403
    assert client.get("/api/registrations/", headers=auth_headers(people["faculty"])).status_code == 403
    admin = auth_headers(people["admin"])
    listing = client.get("/api/registrations/", headers=admin).json()
    assert listing["total"] == 1
    row = listing["items"][0]
    assert row["event_title"] == event.title and row["user_name"] == "Aarav Sharma"
    assert client.get(f"/api/registrations/{reg.id}", headers=admin).json()["status"] == "registered"
    assert client.get(f"/api/registrations/{reg.id}", headers=auth_headers(people["student"])).status_code == 403


def test_registration_create_and_update_are_disabled(client, people, auth_headers, make_event, make_registration):
    event = make_event(people["faculty"])
    reg = make_registration(event, people["student"])
    admin = auth_headers(people["admin"])
    assert client.post("/api/registrations/", json={"event_id": event.id}, headers=admin).status_code == 405
    assert client.put(f"/api/registrations/{reg.id}", json={"status": "cancelled"}, headers=admin).status_code == 405
    assert client.patch(f"/api/registrations/{reg.id}", json={}, headers=admin).status_code == 405


def test_registration_filters(client, people, auth_headers, make_event, make_registration):
    first = make_event(people["faculty"])
    second = make_event(people["faculty"])
    make_registration(first, people["student"])
    make_registration(first, people["student2"], status="waitlisted")
    make_registration(second, people["student"], status="cancelled")
    admin = auth_headers(people["admin"])

    def total(query):
        return client.get(f"/api/registrations/?{query}", headers=admin).json()["total"]

    assert total(f"event_id={first.id}") == 2
    assert total(f"user_id={people['student'].id}") == 2
    assert total("status=waitlisted") == 1
    assert total("status__in=registered,cancelled") == 2
    assert client.get("/api/registrations/?q=anything", headers=admin).status_code == 400


def test_admin_delete_of_a_confirmed_registration_promotes_the_waitlist(
        client, people, auth_headers, make_event, make_registration, session_factory):
    from app.resources.registrations.models import Registration

    event = make_event(people["faculty"], capacity=1)
    now = datetime.now(timezone.utc)
    seated = make_registration(event, people["student"], created_at=now - timedelta(hours=2))
    waiting = make_registration(event, people["student2"], status="waitlisted", created_at=now - timedelta(hours=1))

    res = client.delete(f"/api/registrations/{seated.id}", headers=auth_headers(people["admin"]))
    assert res.status_code == 204
    with session_factory() as db:
        assert db.get(Registration, waiting.id).status == "registered"
        assert db.get(Registration, seated.id) is None


def test_deleting_a_waitlisted_registration_promotes_nobody(
        client, people, auth_headers, make_event, make_registration, session_factory, make_user):
    from app.resources.registrations.models import Registration

    event = make_event(people["faculty"], capacity=1)
    make_registration(event, people["student"])
    waiting = make_registration(event, people["student2"], status="waitlisted")
    third = make_registration(event, make_user(email="third@campus-demo.test"), status="waitlisted")

    assert client.delete(f"/api/registrations/{waiting.id}", headers=auth_headers(people["admin"])).status_code == 204
    with session_factory() as db:
        assert db.get(Registration, third.id).status == "waitlisted"
