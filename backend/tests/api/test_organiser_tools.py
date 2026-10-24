import struct
import zlib
from datetime import datetime, timedelta, timezone

import pytest

from app.domain.uploads import MAX_BYTES
from app.resources.registrations.models import Registration


def png_bytes() -> bytes:
    """A real 1 by 1 PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"\x00\xff\x00\x00"
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 16
GIF = b"GIF89a" + b"\x00" * 16


def upload(client, headers, content, name="cover.png", content_type="image/png"):
    return client.post("/api/uploads/event-image", files={"file": (name, content, content_type)}, headers=headers)


# uploads


def test_organiser_uploads_an_image_and_it_can_be_fetched(client, people, auth_headers):
    res = upload(client, auth_headers(people["faculty"]), png_bytes())
    assert res.status_code == 201
    url = res.json()["url"]
    assert url.startswith("/api/uploads/") and url.endswith(".png")

    fetched = client.get(url)
    assert fetched.status_code == 200
    assert fetched.content == png_bytes()
    assert fetched.headers["content-type"] == "image/png"
    assert fetched.headers["x-content-type-options"] == "nosniff"


def test_the_upload_link_works_as_an_event_cover(client, people, auth_headers):
    headers = auth_headers(people["faculty"])
    url = upload(client, headers, png_bytes()).json()["url"]
    created = client.post("/api/events/", headers=headers, json={
        "title": "With a cover", "category": "Workshop", "venue": "Hall", "capacity": 10,
        "start_time": "2030-05-01T10:00:00Z", "end_time": "2030-05-01T12:00:00Z", "image_url": url,
    })
    assert created.status_code == 201 and created.json()["image_url"] == url


@pytest.mark.parametrize("content,expected", [(JPEG, ".jpg"), (WEBP, ".webp"), (GIF, ".gif")])
def test_other_image_types_are_accepted_by_content(client, people, auth_headers, content, expected):
    # The name and declared type are ignored: the bytes decide.
    res = upload(client, auth_headers(people["admin"]), content, name="whatever.bin", content_type="application/octet-stream")
    assert res.status_code == 201 and res.json()["url"].endswith(expected)


@pytest.mark.parametrize("content,name,ctype", [
    (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "cover.svg", "image/svg+xml"),
    (b"<html><script>alert(1)</script></html>", "cover.png", "image/png"),  # lies about being a PNG
    (b"just some text", "notes.txt", "text/plain"),
    (b"MZ\x90\x00 program", "cover.png", "image/png"),
])
def test_files_that_are_not_real_images_are_refused(client, people, auth_headers, content, name, ctype):
    res = upload(client, auth_headers(people["faculty"]), content, name=name, content_type=ctype)
    assert res.status_code == 400
    assert res.json()["fields"] == {"file": "Not a supported image"}


def test_empty_and_oversized_files_are_refused(client, people, auth_headers):
    headers = auth_headers(people["faculty"])
    assert upload(client, headers, b"").json()["fields"] == {"file": "Choose an image"}
    big = png_bytes() + b"\x00" * MAX_BYTES
    res = upload(client, headers, big)
    assert res.status_code == 400 and res.json()["error"] == "The image is larger than 2 MB"


def test_only_organisers_and_admins_can_upload(client, people, auth_headers):
    assert upload(client, {}, png_bytes()).status_code == 401
    assert upload(client, auth_headers(people["student"]), png_bytes()).status_code == 403
    assert upload(client, auth_headers(people["admin"]), png_bytes()).status_code == 201


def test_two_uploads_never_share_a_name(client, people, auth_headers):
    headers = auth_headers(people["faculty"])
    first = upload(client, headers, png_bytes()).json()["url"]
    second = upload(client, headers, png_bytes()).json()["url"]
    assert first != second


def test_a_name_with_path_tricks_cannot_escape_the_upload_folder(client, people, auth_headers):
    res = upload(client, auth_headers(people["faculty"]), png_bytes(), name="../../evil.png")
    assert res.status_code == 201
    assert "evil" not in res.json()["url"] and ".." not in res.json()["url"]
    assert client.get("/api/uploads/../config.py").status_code in (400, 404)


# removing a participant


def remove(client, event, registration, headers):
    return client.delete(f"/api/events/{event.id}/participants/{registration.id}", headers=headers)


def statuses(session_factory, event):
    with session_factory() as db:
        return {r.user_id: r.status for r in db.query(Registration).filter_by(event_id=event.id)}


def test_removing_a_confirmed_person_promotes_the_oldest_waitlisted(
        client, people, auth_headers, make_event, make_registration, make_user, session_factory):
    event = make_event(people["faculty"], capacity=1)
    now = datetime.now(timezone.utc)
    seated = make_registration(event, people["student"], created_at=now - timedelta(hours=3))
    first = make_user(email="first@campus-demo.test")
    second = make_user(email="second@campus-demo.test")
    make_registration(event, first, status="waitlisted", created_at=now - timedelta(hours=2))
    make_registration(event, second, status="waitlisted", created_at=now - timedelta(hours=1))

    res = remove(client, event, seated, auth_headers(people["faculty"]))
    assert res.status_code == 200
    assert res.json() == {"status": "cancelled", "waitlist_position": None, "message": "Aarav Sharma was removed"}
    found = statuses(session_factory, event)
    assert found[people["student"].id] == "cancelled"
    assert found[first.id] == "registered" and found[second.id] == "waitlisted"


def test_removing_a_waitlisted_person_promotes_nobody(
        client, people, auth_headers, make_event, make_registration, session_factory):
    event = make_event(people["faculty"], capacity=1)
    make_registration(event, people["student"])
    waiting = make_registration(event, people["student2"], status="waitlisted")
    assert remove(client, event, waiting, auth_headers(people["faculty"])).status_code == 200
    found = statuses(session_factory, event)
    assert found[people["student"].id] == "registered" and found[people["student2"].id] == "cancelled"


def test_only_the_organiser_or_an_admin_can_remove_people(client, people, auth_headers, make_event, make_registration):
    event = make_event(people["faculty"])
    reg = make_registration(event, people["student"])
    assert remove(client, event, reg, {}).status_code == 401
    assert remove(client, event, reg, auth_headers(people["student"])).status_code == 403
    assert remove(client, event, reg, auth_headers(people["student2"])).status_code == 403
    assert remove(client, event, reg, auth_headers(people["faculty2"])).status_code == 403
    assert remove(client, event, reg, auth_headers(people["admin"])).status_code == 200


def test_removal_rules(client, people, auth_headers, make_event, make_registration):
    headers = auth_headers(people["faculty"])
    event = make_event(people["faculty"])
    other_event = make_event(people["faculty"])
    reg = make_registration(event, people["student"])
    elsewhere = make_registration(other_event, people["student2"])

    assert client.delete(f"/api/events/{event.id}/participants/99999", headers=headers).status_code == 404
    assert remove(client, event, elsewhere, headers).status_code == 404  # belongs to another event
    assert remove(client, event, reg, headers).status_code == 200
    again = remove(client, event, reg, headers)
    assert again.status_code == 409 and again.json() == {"error": "This person is already removed"}

    over = make_event(people["faculty"], start=datetime.now(timezone.utc) - timedelta(days=2), hours=2)
    old = make_registration(over, people["student"])
    ended = remove(client, over, old, headers)
    assert ended.status_code == 409 and "already ended" in ended.json()["error"]


def test_a_removed_person_can_register_again(client, people, auth_headers, make_event, make_registration):
    event = make_event(people["faculty"])
    reg = make_registration(event, people["student"])
    remove(client, event, reg, auth_headers(people["faculty"]))
    again = client.post(f"/api/events/{event.id}/register", headers=auth_headers(people["student"]))
    assert again.status_code == 201 and again.json()["status"] == "registered"
