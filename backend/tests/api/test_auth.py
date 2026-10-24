from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends

from app.config import get_settings
from app.deps import get_current_user, require_roles

REGISTER = {"name": "Asha Rao", "email": "Asha.Rao@Campus-Demo.test", "password": "secret123", "role": "student"}


def test_register_creates_account_and_returns_token(client):
    res = client.post("/api/auth/register", json=REGISTER)
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "asha.rao@campus-demo.test"  # stored lowercase
    assert body["user"]["role"] == "student"
    assert "password" not in body["user"] and "password_hash" not in body["user"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["id"] == body["user"]["id"]


def test_register_faculty_allowed(client):
    res = client.post("/api/auth/register", json={**REGISTER, "role": "faculty"})
    assert res.status_code == 201 and res.json()["user"]["role"] == "faculty"


def test_register_cannot_create_admin(client):
    res = client.post("/api/auth/register", json={**REGISTER, "role": "admin"})
    assert res.status_code == 422 and "role" in res.json()["fields"]


def test_register_duplicate_email_is_a_friendly_conflict(client):
    client.post("/api/auth/register", json=REGISTER)
    res = client.post("/api/auth/register", json={**REGISTER, "email": "asha.rao@campus-demo.test"})
    assert res.status_code == 409
    assert res.json() == {"error": "Email already in use", "fields": {"email": "Already in use"}}


def test_register_validation_errors_name_the_fields(client):
    res = client.post("/api/auth/register", json={"name": "", "email": "nope", "password": "short"})
    assert res.status_code == 422
    assert set(res.json()["fields"]) == {"name", "email", "password"}
    assert res.json()["fields"]["email"] == "Enter a valid email address"


def test_login_success_is_case_insensitive_on_email(client, make_user):
    make_user(email="ravi@campus-demo.test", password="password123")
    res = client.post("/api/auth/login", json={"email": "RAVI@campus-demo.test", "password": "password123"})
    assert res.status_code == 200
    assert res.json()["token_type"] == "bearer" and res.json()["user"]["email"] == "ravi@campus-demo.test"


def test_login_failures_do_not_reveal_which_part_was_wrong(client, make_user):
    make_user(email="ravi@campus-demo.test")
    wrong_password = client.post("/api/auth/login", json={"email": "ravi@campus-demo.test", "password": "bad-pass"})
    unknown_email = client.post("/api/auth/login", json={"email": "who@campus-demo.test", "password": "password123"})
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json() == {"error": "Incorrect email or password"}


def test_me_requires_a_valid_token(client, make_user, auth_headers):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401

    user = make_user()
    assert client.get("/api/auth/me", headers=auth_headers(user)).json()["email"] == user.email


def test_expired_token_is_rejected(client, make_user):
    user = make_user()
    settings = get_settings()
    expired = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        settings.jwt_secret, algorithm="HS256",
    )
    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert res.status_code == 401 and "expired" in res.json()["error"]


def test_token_signed_with_another_secret_is_rejected(client, make_user):
    user = make_user()
    forged = jwt.encode({"sub": str(user.id), "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                        "some-other-secret-that-is-long-enough", algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_token_for_a_deleted_user_is_rejected(client, make_user, auth_headers, session_factory):
    user = make_user()
    headers = auth_headers(user)
    with session_factory() as db:
        db.delete(db.get(type(user), user.id))
        db.commit()
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_login_is_rate_limited(client, make_user):
    make_user(email="ravi@campus-demo.test")
    codes = [
        client.post("/api/auth/login", json={"email": "ravi@campus-demo.test", "password": "wrong-pass"}).status_code
        for _ in range(12)
    ]
    assert codes[:10] == [401] * 10
    assert codes[10:] == [429, 429]
    blocked = client.post("/api/auth/login", json={"email": "ravi@campus-demo.test", "password": "password123"})
    assert blocked.status_code == 429 and blocked.headers["Retry-After"] == "60"


def test_role_guard_dependency(app, client, make_user, auth_headers):
    @app.get("/api/_admin-only")
    def admin_only(user=Depends(require_roles("admin"))):
        return {"ok": True}

    @app.get("/api/_any-user")
    def any_user(user=Depends(get_current_user)):
        return {"id": user.id}

    admin = make_user(email="admin@campus-demo.test", role="admin")
    student = make_user(email="s@campus-demo.test", role="student")

    assert client.get("/api/_admin-only").status_code == 401
    forbidden = client.get("/api/_admin-only", headers=auth_headers(student))
    assert forbidden.status_code == 403 and forbidden.json() == {"error": "You do not have permission to do this"}
    assert client.get("/api/_admin-only", headers=auth_headers(admin)).status_code == 200
    assert client.get("/api/_any-user", headers=auth_headers(student)).status_code == 200


def test_auth_routes_documented(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert {"/api/auth/register", "/api/auth/login", "/api/auth/me"} <= set(paths)
