def test_only_admin_lists_users(client, people, auth_headers):
    assert client.get("/api/users/").status_code == 401
    assert client.get("/api/users/", headers=auth_headers(people["student"])).status_code == 403
    assert client.get("/api/users/", headers=auth_headers(people["faculty"])).status_code == 403
    res = client.get("/api/users/", headers=auth_headers(people["admin"]))
    assert res.status_code == 200 and res.json()["total"] == 5


def test_no_response_contains_a_password_hash(client, people, auth_headers):
    admin = auth_headers(people["admin"])
    listing = client.get("/api/users/", headers=admin)
    one = client.get(f"/api/users/{people['student'].id}", headers=admin)
    assert "password" not in listing.text and "password" not in one.text


def test_user_reads_only_their_own_profile(client, people, auth_headers):
    student = auth_headers(people["student"])
    assert client.get(f"/api/users/{people['student'].id}", headers=student).status_code == 200
    assert client.get(f"/api/users/{people['student2'].id}", headers=student).status_code == 403


def test_user_updates_own_profile_but_not_role_or_email(client, people, auth_headers):
    student = auth_headers(people["student"])
    url = f"/api/users/{people['student'].id}"
    res = client.patch(url, json={"name": "Aarav S", "department": "School of Law",
                                  "role": "admin", "email": "new@campus-demo.test"}, headers=student)
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Aarav S" and body["department"] == "School of Law"
    assert body["role"] == "student"
    assert body["email"] == "student@campus-demo.test"


def test_user_cannot_edit_someone_else(client, people, auth_headers):
    res = client.patch(f"/api/users/{people['student2'].id}", json={"name": "Hacked"},
                       headers=auth_headers(people["student"]))
    assert res.status_code == 403


def test_admin_updates_email_and_user_can_change_password(client, people, auth_headers):
    url = f"/api/users/{people['student'].id}"
    assert client.patch(url, json={"email": "Renamed@Campus-Demo.test"},
                        headers=auth_headers(people["admin"])).json()["email"] == "renamed@campus-demo.test"

    assert client.patch(url, json={"password": "brand-new-pass"}, headers=auth_headers(people["student"])).status_code == 200
    login = client.post("/api/auth/login", json={"email": "renamed@campus-demo.test", "password": "brand-new-pass"})
    assert login.status_code == 200


def test_admin_creates_user_with_any_role(client, people, auth_headers):
    admin = auth_headers(people["admin"])
    res = client.post("/api/users/", headers=admin, json={
        "name": "Second Admin", "email": "admin2@campus-demo.test", "password": "password123", "role": "admin"})
    assert res.status_code == 201 and res.json()["role"] == "admin" and "password" not in res.text
    dup = client.post("/api/users/", headers=admin, json={
        "name": "Again", "email": "ADMIN2@campus-demo.test", "password": "password123"})
    assert dup.status_code == 409 and dup.json()["fields"] == {"email": "Already in use"}
    assert client.post("/api/users/", headers=auth_headers(people["faculty"]), json={
        "name": "X", "email": "x@campus-demo.test", "password": "password123"}).status_code == 403


def test_delete_rules(client, people, auth_headers):
    admin = auth_headers(people["admin"])
    assert client.delete(f"/api/users/{people['student2'].id}", headers=auth_headers(people["student"])).status_code == 403
    own = client.delete(f"/api/users/{people['admin'].id}", headers=admin)
    assert own.status_code == 403 and own.json() == {"error": "You cannot delete your own account"}
    assert client.delete(f"/api/users/{people['student2'].id}", headers=admin).status_code == 204


def test_cannot_delete_a_user_who_organizes_events(client, people, auth_headers, make_event):
    make_event(people["faculty"])
    res = client.delete(f"/api/users/{people['faculty'].id}", headers=auth_headers(people["admin"]))
    assert res.status_code == 409 and "depend" in res.json()["error"]


def test_user_list_filters_search_and_sort(client, people, auth_headers):
    admin = auth_headers(people["admin"])
    assert client.get("/api/users/?role=faculty", headers=admin).json()["total"] == 2
    assert client.get("/api/users/?role__in=admin,student", headers=admin).json()["total"] == 3
    found = client.get("/api/users/?q=KULKARNI", headers=admin).json()["items"]
    assert [u["name"] for u in found] == ["Arvind Kulkarni"]
    assert client.get("/api/users/?sort=password_hash", headers=admin).status_code == 400
    assert client.get("/api/users/?password_hash=x", headers=admin).status_code == 400
    names = [u["name"] for u in client.get("/api/users/?sort=-name", headers=admin).json()["items"]]
    assert names == sorted(names, reverse=True)
