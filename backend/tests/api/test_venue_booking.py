import threading

import pytest
from fastapi.testclient import TestClient

from app.db import get_db

SLOT = {"start_time": "2030-05-01T10:00:00Z", "end_time": "2030-05-01T12:00:00Z"}


def body(title="Robotics workshop", venue="Innovation Lab", **extra):
    return {"title": title, "description": "", "category": "Workshop", "venue": venue, "capacity": 20, **SLOT, **extra}


def create(client, headers, **kwargs):
    return client.post("/api/events/", json=body(**kwargs), headers=headers)


@pytest.fixture()
def booked(client, people, auth_headers):
    """Organiser 1 holds Innovation Lab from 10:00 to 12:00."""
    res = create(client, auth_headers(people["faculty"]))
    assert res.status_code == 201
    return res.json()


def test_a_second_organiser_cannot_take_the_same_room_at_the_same_time(client, people, auth_headers, booked):
    res = create(client, auth_headers(people["faculty2"]), title="Hack night")
    assert res.status_code == 409
    assert res.json() == {
        "error": 'Innovation Lab is already booked at that time by "Robotics workshop"',
        "fields": {"venue": 'Already booked at that time by "Robotics workshop"'},
    }


@pytest.mark.parametrize("start,end", [
    ("2030-05-01T11:00:00Z", "2030-05-01T13:00:00Z"),  # overlaps the end
    ("2030-05-01T09:00:00Z", "2030-05-01T10:30:00Z"),  # overlaps the start
    ("2030-05-01T10:30:00Z", "2030-05-01T11:30:00Z"),  # inside
    ("2030-05-01T08:00:00Z", "2030-05-01T14:00:00Z"),  # contains it
])
def test_any_overlap_is_a_clash(client, people, auth_headers, booked, start, end):
    res = create(client, auth_headers(people["faculty2"]), title="Other", start_time=start, end_time=end)
    assert res.status_code == 409


@pytest.mark.parametrize("start,end", [
    ("2030-05-01T12:00:00Z", "2030-05-01T14:00:00Z"),  # starts the moment the first ends
    ("2030-05-01T08:00:00Z", "2030-05-01T10:00:00Z"),  # ends the moment the first starts
    ("2030-05-02T10:00:00Z", "2030-05-02T12:00:00Z"),  # another day
])
def test_back_to_back_and_other_days_are_fine(client, people, auth_headers, booked, start, end):
    assert create(client, auth_headers(people["faculty2"]), title="Other", start_time=start, end_time=end).status_code == 201


def test_a_different_room_at_the_same_time_is_fine(client, people, auth_headers, booked):
    assert create(client, auth_headers(people["faculty2"]), title="Other", venue="Seminar Hall").status_code == 201


@pytest.mark.parametrize("spelling", ["innovation lab", "  Innovation   Lab  ", "INNOVATION LAB"])
def test_spelling_case_and_spaces_do_not_hide_a_clash(client, people, auth_headers, booked, spelling):
    assert create(client, auth_headers(people["faculty2"]), title="Other", venue=spelling).status_code == 409


def test_a_cancelled_event_frees_the_room(client, people, auth_headers, booked):
    client.patch(f"/api/events/{booked['id']}", json={"status": "cancelled"}, headers=auth_headers(people["faculty"]))
    assert create(client, auth_headers(people["faculty2"]), title="Other").status_code == 201


def test_bringing_a_cancelled_event_back_is_checked_too(client, people, auth_headers, booked):
    headers = auth_headers(people["faculty"])
    client.patch(f"/api/events/{booked['id']}", json={"status": "cancelled"}, headers=headers)
    assert create(client, auth_headers(people["faculty2"]), title="Other").status_code == 201
    res = client.patch(f"/api/events/{booked['id']}", json={"status": "published"}, headers=headers)
    assert res.status_code == 409 and "Other" in res.json()["error"]


# editing


def test_moving_an_event_into_a_taken_slot_is_refused(client, people, auth_headers, booked):
    other = create(client, auth_headers(people["faculty2"]), title="Other", start_time="2030-05-03T10:00:00Z",
                   end_time="2030-05-03T12:00:00Z").json()
    res = client.patch(f"/api/events/{other['id']}", json=SLOT, headers=auth_headers(people["faculty2"]))
    assert res.status_code == 409 and res.json()["fields"]["venue"].startswith("Already booked")

    res = client.patch(f"/api/events/{other['id']}", json={"venue": "Innovation Lab", **SLOT}, headers=auth_headers(people["faculty2"]))
    assert res.status_code == 409


def test_saving_an_event_again_does_not_clash_with_itself(client, people, auth_headers, booked):
    headers = auth_headers(people["faculty"])
    assert client.patch(f"/api/events/{booked['id']}", json={**SLOT, "venue": "Innovation Lab"}, headers=headers).status_code == 200
    assert client.patch(f"/api/events/{booked['id']}", json={"start_time": "2030-05-01T10:30:00Z"}, headers=headers).status_code == 200


def test_an_unrelated_edit_is_not_blocked_by_an_old_double_booking(
        client, people, auth_headers, make_event, session_factory):
    from datetime import datetime, timezone

    start = datetime(2030, 6, 1, 10, tzinfo=timezone.utc)
    first = make_event(people["faculty"], title="One", start=start, venue="Seminar Hall")
    second = make_event(people["faculty2"], title="Two", start=start, venue="Seminar Hall")  # already double booked
    res = client.patch(f"/api/events/{second.id}", json={"title": "Two, renamed", "capacity": 12}, headers=auth_headers(people["faculty2"]))
    assert res.status_code == 200
    # But touching the booking itself runs the check.
    assert client.patch(f"/api/events/{second.id}", json={"venue": "Seminar Hall"}, headers=auth_headers(people["faculty2"])).status_code == 409
    assert first.id != second.id


# the admin override


def test_organisers_cannot_override_a_clash(client, people, auth_headers, booked):
    res = create(client, auth_headers(people["faculty2"]), title="Other", allow_venue_clash=True)
    assert res.status_code == 403
    assert res.json() == {"error": "Only an admin can book a venue that is already taken"}


def test_an_admin_can_double_book_on_purpose(client, people, auth_headers, booked):
    res = create(client, auth_headers(people["admin"]), title="Joint event", allow_venue_clash=True)
    assert res.status_code == 201
    assert "allow_venue_clash" not in res.json()
    # Without the flag, even an admin is stopped.
    assert create(client, auth_headers(people["admin"]), title="Accident").status_code == 409


def test_an_admin_can_override_when_editing(client, people, auth_headers, booked):
    other = create(client, auth_headers(people["faculty2"]), title="Other", start_time="2030-05-03T10:00:00Z",
                   end_time="2030-05-03T12:00:00Z").json()
    res = client.patch(f"/api/events/{other['id']}", json={**SLOT, "allow_venue_clash": True}, headers=auth_headers(people["admin"]))
    assert res.status_code == 200


# the check the form uses


def check(client, headers, **params):
    base = {"venue": "Innovation Lab", "start_time": "2030-05-01T11:00:00Z", "end_time": "2030-05-01T13:00:00Z"}
    return client.get("/api/events/venue-check", params={**base, **params}, headers=headers)


def test_venue_check_reports_the_clash_so_the_form_can_warn(client, people, auth_headers, booked):
    res = check(client, auth_headers(people["faculty2"]))
    assert res.status_code == 200
    clash = res.json()["clash"]
    assert clash["title"] == "Robotics workshop" and clash["organizer_name"] == "Meenakshi Iyer"
    assert clash["start_time"].startswith("2030-05-01T10:00") and clash["end_time"].startswith("2030-05-01T12:00")


def test_venue_check_is_quiet_when_there_is_no_clash(client, people, auth_headers, booked):
    headers = auth_headers(people["faculty2"])
    assert check(client, headers, venue="Seminar Hall").json() == {"clash": None}
    assert check(client, headers, start_time="2030-05-01T12:00:00Z", end_time="2030-05-01T13:00:00Z").json() == {"clash": None}
    assert check(client, headers, end_time="2030-05-01T10:00:00Z").json() == {"clash": None}  # end before start
    assert check(client, headers, venue="   ").json() == {"clash": None}
    # Editing an event: it does not clash with itself.
    assert check(client, auth_headers(people["faculty"]), exclude_id=booked["id"], start_time=SLOT["start_time"],
                 end_time=SLOT["end_time"]).json() == {"clash": None}


def test_venue_check_is_for_organisers_and_admins(client, people, auth_headers, booked):
    assert check(client, {}).status_code == 401
    assert check(client, auth_headers(people["student"])).status_code == 403
    assert check(client, auth_headers(people["admin"])).status_code == 200


def test_venue_check_does_not_leave_the_venue_locked(client, people, auth_headers, booked):
    # If the lock were kept, this save would wait for it and the test would hang.
    assert check(client, auth_headers(people["faculty2"])).status_code == 200
    assert create(client, auth_headers(people["faculty2"]), title="Other", venue="Seminar Hall").status_code == 201


# two organisers at the same instant


def test_two_organisers_saving_the_same_room_at_once_get_one_booking(app, people, auth_headers):
    first, second = TestClient(app), TestClient(app)
    barrier = threading.Barrier(2)
    results = {}

    def book(name, client, headers):
        barrier.wait()
        results[name] = client.post("/api/events/", json=body(title=name), headers=headers).status_code

    threads = [
        threading.Thread(target=book, args=("First", first, auth_headers(people["faculty"]))),
        threading.Thread(target=book, args=("Second", second, auth_headers(people["faculty2"]))),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results.values()) == [201, 409]
    listing = first.get("/api/events/?venue=Innovation Lab", headers=auth_headers(people["admin"])).json()
    assert listing["total"] == 1
