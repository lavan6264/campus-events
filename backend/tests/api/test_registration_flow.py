import csv
import io
import threading
from datetime import datetime, timedelta, timezone

import pytest

from app.core.crud import Conflict
from app.resources.registrations.logic import register_user
from app.resources.registrations.models import Registration


def register(client, event, headers):
    return client.post(f"/api/events/{event.id}/register", headers=headers)


def cancel(client, event, headers):
    return client.delete(f"/api/events/{event.id}/register", headers=headers)


def statuses(session_factory, event):
    with session_factory() as db:
        return {r.user_id: r.status for r in db.query(Registration).filter_by(event_id=event.id)}


@pytest.fixture()
def crowd(make_user):
    return [make_user(email=f"crowd{i}@campus-demo.test", name=f"Crowd {i}") for i in range(6)]


# categories and basic registration


def test_categories_route_wins_over_event_id(client, people, auth_headers):
    res = client.get("/api/events/categories", headers=auth_headers(people["student"]))
    assert res.status_code == 200
    assert res.json() == ["Workshop", "Seminar", "Competition", "Cultural", "Sports", "Club Meet"]
    assert client.get("/api/events/categories").status_code == 401


def test_register_confirms_a_seat(client, people, auth_headers, make_event):
    event = make_event(people["faculty"], capacity=5)
    res = register(client, event, auth_headers(people["student"]))
    assert res.status_code == 201
    assert res.json() == {"status": "registered", "waitlist_position": None, "message": "You are registered"}
    detail = client.get(f"/api/events/{event.id}", headers=auth_headers(people["student"])).json()
    assert (detail["registered_count"], detail["seats_left"], detail["my_status"]) == (1, 4, "registered")


def test_duplicate_registration_is_a_friendly_conflict(client, people, auth_headers, make_event):
    event = make_event(people["faculty"])
    headers = auth_headers(people["student"])
    register(client, event, headers)
    again = register(client, event, headers)
    assert again.status_code == 409 and again.json() == {"error": "You are already registered for this event"}


def test_registration_requires_sign_in_and_a_real_event(client, people, auth_headers, make_event):
    event = make_event(people["faculty"])
    assert client.post(f"/api/events/{event.id}/register").status_code == 401
    assert client.post("/api/events/99999/register", headers=auth_headers(people["student"])).status_code == 404


def test_faculty_and_admin_can_register_too(client, people, auth_headers, make_event):
    event = make_event(people["faculty2"])
    assert register(client, event, auth_headers(people["faculty"])).status_code == 201
    assert register(client, event, auth_headers(people["admin"])).status_code == 201


# waitlist


def test_full_event_waitlists_in_order(client, people, auth_headers, make_event, crowd):
    event = make_event(people["faculty"], capacity=1)
    assert register(client, event, auth_headers(crowd[0])).json()["status"] == "registered"
    first = register(client, event, auth_headers(crowd[1])).json()
    second = register(client, event, auth_headers(crowd[2])).json()
    assert first["status"] == "waitlisted" and first["waitlist_position"] == 1
    assert second["waitlist_position"] == 2
    assert second["message"] == "The event is full. You are on the waitlist (position 2)"
    again = register(client, event, auth_headers(crowd[2]))
    assert again.status_code == 409 and "waitlist" in again.json()["error"]

    detail = client.get(f"/api/events/{event.id}", headers=auth_headers(crowd[2])).json()
    assert (detail["registered_count"], detail["waitlisted_count"], detail["seats_left"]) == (1, 2, 0)
    assert (detail["my_status"], detail["my_waitlist_position"]) == ("waitlisted", 2)


def test_cancelling_a_seat_promotes_the_oldest_waitlisted_user(
        client, people, auth_headers, make_event, crowd, session_factory):
    event = make_event(people["faculty"], capacity=1)
    for person in crowd[:4]:
        register(client, event, auth_headers(person))

    res = cancel(client, event, auth_headers(crowd[0]))
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    found = statuses(session_factory, event)
    assert found[crowd[0].id] == "cancelled" and found[crowd[1].id] == "registered"
    assert found[crowd[2].id] == "waitlisted" and found[crowd[3].id] == "waitlisted"

    detail = client.get(f"/api/events/{event.id}", headers=auth_headers(crowd[3])).json()
    assert detail["my_waitlist_position"] == 2


def test_leaving_the_waitlist_promotes_nobody_and_moves_others_up(
        client, people, auth_headers, make_event, crowd, session_factory):
    event = make_event(people["faculty"], capacity=1)
    for person in crowd[:4]:
        register(client, event, auth_headers(person))
    assert cancel(client, event, auth_headers(crowd[1])).status_code == 200

    found = statuses(session_factory, event)
    assert found[crowd[0].id] == "registered" and found[crowd[2].id] == "waitlisted"
    pos = client.get(f"/api/events/{event.id}", headers=auth_headers(crowd[3])).json()["my_waitlist_position"]
    assert pos == 2


def test_cancel_when_not_registered(client, people, auth_headers, make_event):
    event = make_event(people["faculty"])
    res = cancel(client, event, auth_headers(people["student"]))
    assert res.status_code == 404 and res.json() == {"error": "You are not registered for this event"}
    register(client, event, auth_headers(people["student"]))
    cancel(client, event, auth_headers(people["student"]))
    assert cancel(client, event, auth_headers(people["student"])).status_code == 404


def test_register_again_after_cancelling_goes_to_the_back(client, people, auth_headers, make_event, crowd, session_factory):
    event = make_event(people["faculty"], capacity=1)
    register(client, event, auth_headers(crowd[0]))
    register(client, event, auth_headers(crowd[1]))  # waitlist 1
    cancel(client, event, auth_headers(crowd[1]))
    register(client, event, auth_headers(crowd[2]))  # waitlist 1
    back = register(client, event, auth_headers(crowd[1]))
    assert back.status_code == 201 and back.json()["waitlist_position"] == 2
    with session_factory() as db:
        assert db.query(Registration).filter_by(event_id=event.id, user_id=crowd[1].id).count() == 1


# closed events


def test_cannot_register_for_cancelled_or_ended_events(client, people, auth_headers, make_event):
    headers = auth_headers(people["student"])
    called_off = make_event(people["faculty"], status="cancelled")
    over = make_event(people["faculty"], start=datetime.now(timezone.utc) - timedelta(days=2), hours=2)
    assert register(client, called_off, headers).json() == {"error": "Registration closed, event cancelled"}
    assert register(client, over, headers).json() == {"error": "Registration closed, event ended"}
    assert register(client, over, headers).status_code == 409


def test_cannot_cancel_after_the_event_ended(client, people, auth_headers, make_event, make_registration):
    over = make_event(people["faculty"], start=datetime.now(timezone.utc) - timedelta(days=2), hours=2)
    make_registration(over, people["student"])
    res = cancel(client, over, auth_headers(people["student"]))
    assert res.status_code == 409 and res.json() == {"error": "Cannot cancel, event already ended"}


# time clashes


def test_clash_names_the_conflicting_event(client, people, auth_headers, make_event):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    first = make_event(people["faculty"], title="Robotics workshop", start=base, hours=3)
    second = make_event(people["faculty2"], title="Hack night", start=base + timedelta(hours=2), hours=3)
    headers = auth_headers(people["student"])
    assert register(client, first, headers).status_code == 201
    res = register(client, second, headers)
    assert res.status_code == 409
    assert res.json() == {"error": 'This event clashes with "Robotics workshop", which you are already registered for'}


def test_back_to_back_events_do_not_clash(client, people, auth_headers, make_event):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    first = make_event(people["faculty"], start=base, hours=2)
    second = make_event(people["faculty2"], start=base + timedelta(hours=2), hours=2)
    headers = auth_headers(people["student"])
    assert register(client, first, headers).status_code == 201
    assert register(client, second, headers).status_code == 201


def test_cancelling_removes_the_clash(client, people, auth_headers, make_event):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    first = make_event(people["faculty"], start=base)
    second = make_event(people["faculty2"], start=base + timedelta(minutes=30))
    headers = auth_headers(people["student"])
    register(client, first, headers)
    assert register(client, second, headers).status_code == 409
    cancel(client, first, headers)
    assert register(client, second, headers).status_code == 201


def test_waitlisted_registrations_never_block_other_events(client, people, auth_headers, make_event, make_registration):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    full = make_event(people["faculty"], start=base, capacity=1)
    make_registration(full, people["student2"])
    other = make_event(people["faculty2"], start=base + timedelta(hours=1))
    headers = auth_headers(people["student"])
    assert register(client, full, headers).json()["status"] == "waitlisted"
    assert register(client, other, headers).status_code == 201


def test_a_full_event_can_still_be_waitlisted_despite_a_clash(client, people, auth_headers, make_event, make_registration):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    mine = make_event(people["faculty"], start=base)
    full = make_event(people["faculty2"], start=base + timedelta(hours=1), capacity=1)
    make_registration(full, people["student2"])
    headers = auth_headers(people["student"])
    register(client, mine, headers)
    assert register(client, full, headers).json()["status"] == "waitlisted"


def test_promotion_into_a_clash_is_kept_and_both_events_show_a_notice(
        client, people, auth_headers, make_event, make_registration, session_factory):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    mine = make_event(people["faculty"], title="Mine", start=base)
    full = make_event(people["faculty2"], title="Popular", start=base + timedelta(hours=1), capacity=1)
    holder = make_registration(full, people["student2"])
    headers = auth_headers(people["student"])
    register(client, mine, headers)
    register(client, full, headers)  # waitlisted

    assert cancel(client, full, auth_headers(people["student2"])).status_code == 200
    assert statuses(session_factory, full)[people["student"].id] == "registered"
    assert statuses(session_factory, mine)[people["student"].id] == "registered"

    mine_view = client.get(f"/api/events/{mine.id}", headers=headers).json()
    full_view = client.get(f"/api/events/{full.id}", headers=headers).json()
    assert mine_view["clash_with_title"] == "Popular" and full_view["clash_with_title"] == "Mine"
    assert holder.id  # the original holder row still exists as cancelled


# participants


def test_participants_access(client, people, auth_headers, make_event, make_registration):
    event = make_event(people["faculty"])
    make_registration(event, people["student"])
    url = f"/api/events/{event.id}/participants"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=auth_headers(people["student"])).status_code == 403
    assert client.get(url, headers=auth_headers(people["faculty2"])).status_code == 403
    assert client.get(url, headers=auth_headers(people["faculty"])).json()["total"] == 1
    assert client.get(url, headers=auth_headers(people["admin"])).json()["total"] == 1
    assert client.get("/api/events/99999/participants", headers=auth_headers(people["admin"])).status_code == 404


def test_participants_list_search_status_and_pages(client, people, auth_headers, make_event, make_registration, crowd):
    event = make_event(people["faculty"], capacity=2)
    now = datetime.now(timezone.utc)
    for i, person in enumerate(crowd[:4]):
        make_registration(event, person, status="registered" if i < 2 else "waitlisted",
                          created_at=now - timedelta(hours=10 - i))
    make_registration(event, people["student"], status="cancelled")
    headers = auth_headers(people["faculty"])
    url = f"/api/events/{event.id}/participants"

    everyone = client.get(url, headers=headers).json()
    assert everyone["total"] == 4  # cancelled hidden by default
    assert [p["waitlist_position"] for p in everyone["items"]] == [None, None, 1, 2]
    assert "password" not in str(everyone)

    assert client.get(url + "?status=waitlisted", headers=headers).json()["total"] == 2
    assert client.get(url + "?status=cancelled", headers=headers).json()["items"][0]["name"] == "Aarav Sharma"
    assert [p["name"] for p in client.get(url + "?q=CROWD 3", headers=headers).json()["items"]] == ["Crowd 3"]
    paged = client.get(url + "?page=2&limit=3&sort=name", headers=headers).json()
    assert (paged["total"], paged["pages"], len(paged["items"])) == (4, 2, 1)
    assert client.get(url + "?status=banana", headers=headers).status_code == 400
    assert client.get(url + "?sort=email", headers=headers).status_code == 400
    assert client.get(url + "?foo=1", headers=headers).status_code == 400


def test_participants_csv(client, people, auth_headers, make_event, make_registration, make_user):
    event = make_event(people["faculty"], capacity=1)
    make_registration(event, people["student"])
    sneaky = make_user(email="sneaky@campus-demo.test", name='=HYPERLINK("http://x.test")')
    make_registration(event, sneaky, status="waitlisted")

    url = f"/api/events/{event.id}/participants.csv"
    assert client.get(url, headers=auth_headers(people["student"])).status_code == 403
    res = client.get(url, headers=auth_headers(people["faculty"]))
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert res.headers["content-disposition"] == f'attachment; filename="event-{event.id}-participants.csv"'
    rows = list(csv.reader(io.StringIO(res.text.lstrip("﻿"))))
    assert rows[0] == ["Name", "Email", "Department", "Status", "Waitlist position", "Registered at"]
    assert rows[1][0] == "Aarav Sharma" and rows[1][3] == "registered"
    assert rows[2][0].startswith("'=") and rows[2][3] == "waitlisted" and rows[2][4] == "1"


# me


def test_my_registrations(client, people, auth_headers, make_event, make_registration):
    now = datetime.now(timezone.utc)
    soon = make_event(people["faculty"], title="Soon", days=2)
    later = make_event(people["faculty"], title="Later", days=9)
    full = make_event(people["faculty2"], title="Full", days=4, capacity=1)
    past = make_event(people["faculty"], title="Past", start=now - timedelta(days=3))
    dropped = make_event(people["faculty"], title="Dropped", days=6)
    make_registration(later, people["student"])
    make_registration(soon, people["student"])
    make_registration(full, people["student2"])
    make_registration(full, people["student"], status="waitlisted")
    make_registration(past, people["student"])
    make_registration(dropped, people["student"], status="cancelled")
    headers = auth_headers(people["student"])

    res = client.get("/api/me/registrations", headers=headers).json()
    assert [r["event"]["title"] for r in res["items"]] == ["Past", "Soon", "Full", "Later"]
    waiting = next(r for r in res["items"] if r["event"]["title"] == "Full")
    assert waiting["status"] == "waitlisted" and waiting["waitlist_position"] == 1
    assert waiting["event"]["my_status"] == "waitlisted" and waiting["event"]["organizer_name"] == "Arvind Kulkarni"

    upcoming = client.get("/api/me/registrations?upcoming=true", headers=headers).json()
    assert [r["event"]["title"] for r in upcoming["items"]] == ["Soon", "Full", "Later"]
    only_past = client.get("/api/me/registrations?upcoming=false", headers=headers).json()
    assert [r["event"]["title"] for r in only_past["items"]] == ["Past"]
    cancelled = client.get("/api/me/registrations?status=cancelled", headers=headers).json()
    assert [r["event"]["title"] for r in cancelled["items"]] == ["Dropped"]
    assert client.get("/api/me/registrations?status=nope", headers=headers).status_code == 400
    assert client.get("/api/me/registrations?upcoming=maybe", headers=headers).status_code == 400
    assert client.get("/api/me/registrations?color=red", headers=headers).status_code == 400
    assert client.get("/api/me/registrations").status_code == 401


def test_my_events_lists_only_events_i_organise(client, people, auth_headers, make_event):
    make_event(people["faculty"], title="Mine A", days=3)
    make_event(people["faculty"], title="Mine B", days=1)
    make_event(people["faculty2"], title="Theirs")
    res = client.get("/api/me/events", headers=auth_headers(people["faculty"])).json()
    assert [e["title"] for e in res["items"]] == ["Mine B", "Mine A"] and res["total"] == 2
    assert client.get("/api/me/events?q=a", headers=auth_headers(people["faculty"])).json()["total"] == 2
    assert client.get("/api/me/events", headers=auth_headers(people["student"])).json()["total"] == 0


# concurrency


def _run_together(session_factory, jobs):
    """Runs every job in its own thread and session, released at the same instant."""
    barrier = threading.Barrier(len(jobs))
    outcomes = [None] * len(jobs)

    def worker(index, user, event_id):
        with session_factory() as db:
            barrier.wait()
            try:
                registration = register_user(db, user, event_id)
                db.commit()
                outcomes[index] = registration.status
            except Conflict as exc:
                db.rollback()
                outcomes[index] = f"conflict: {exc.message}"

    threads = [threading.Thread(target=worker, args=(i, u, e)) for i, (u, e) in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return outcomes


def test_concurrent_requests_for_the_last_seat_admit_exactly_one(session_factory, people, make_event, make_user):
    event = make_event(people["faculty"], capacity=1)
    users = [make_user(email=f"race{i}@campus-demo.test") for i in range(10)]
    outcomes = _run_together(session_factory, [(u, event.id) for u in users])
    assert outcomes.count("registered") == 1
    assert outcomes.count("waitlisted") == 9
    with session_factory() as db:
        rows = db.query(Registration).filter_by(event_id=event.id).all()
        assert sum(r.status == "registered" for r in rows) == 1 and len(rows) == 10


def test_concurrent_requests_never_exceed_capacity(session_factory, people, make_event, make_user):
    event = make_event(people["faculty"], capacity=4)
    users = [make_user(email=f"burst{i}@campus-demo.test") for i in range(12)]
    outcomes = _run_together(session_factory, [(u, event.id) for u in users])
    assert outcomes.count("registered") == 4 and outcomes.count("waitlisted") == 8


def test_one_person_cannot_confirm_two_overlapping_events_at_once(session_factory, people, make_event):
    base = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)
    first = make_event(people["faculty"], start=base)
    second = make_event(people["faculty2"], start=base + timedelta(minutes=30))
    user = people["student"]
    outcomes = _run_together(session_factory, [(user, first.id), (user, second.id)])
    assert sorted(o.split(":")[0] for o in outcomes) == ["conflict", "registered"]


def test_double_click_registers_once(session_factory, people, make_event):
    event = make_event(people["faculty"])
    outcomes = _run_together(session_factory, [(people["student"], event.id)] * 2)
    assert sorted(o.split(":")[0] for o in outcomes) == ["conflict", "registered"]
    with session_factory() as db:
        assert db.query(Registration).filter_by(event_id=event.id).count() == 1
