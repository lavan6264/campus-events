import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from tests.core import dummy

STAFF = {"X-Role": "staff", "X-User-Id": "10"}
OTHER_STAFF = {"X-Role": "staff", "X-User-Id": "11"}
ADMIN = {"X-Role": "admin", "X-User-Id": "1"}
VIEWER = {"X-Role": "viewer", "X-User-Id": "20"}


@pytest.fixture()
def client(override_db):
    app = dummy.build_app()
    app.dependency_overrides[get_db] = override_db
    dummy.CALLS.clear()
    return TestClient(app)


def make(client, name="Alpha", sku="A-1", category="Tools", price=50, headers=STAFF, **extra):
    body = {"name": name, "sku": sku, "category": category, "price": price, **extra}
    res = client.post("/api/widgets/", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


@pytest.fixture()
def catalog(client):
    rows = [
        ("Bolt", "B-1", "Hardware", 5), ("Drill", "D-1", "Tools", 120), ("Hammer", "H-1", "Tools", 30),
        ("Lamp", "L-1", "Lighting", 80), ("Nail", "N-1", "Hardware", 1), ("Saw", "S-1", "Tools", 150),
        ("Screw", "S-2", "Hardware", 2), ("Torch", "T-1", "Lighting", 60),
    ]
    for name, sku, cat, price in rows:
        make(client, name, sku, cat, price)
    return client


def names(res):
    return [item["name"] for item in res.json()["items"]]


# CRUD actions


def test_full_crud_cycle(client):
    created = make(client)
    assert created["owner_id"] == 10 and created["active"] is True
    wid = created["id"]

    assert client.get(f"/api/widgets/{wid}", headers=VIEWER).json()["name"] == "Alpha"

    put = client.put(f"/api/widgets/{wid}", json={"price": 75}, headers=STAFF)
    assert put.status_code == 200 and put.json()["price"] == 75 and put.json()["name"] == "Alpha"

    patch = client.patch(f"/api/widgets/{wid}", json={"name": "Beta"}, headers=STAFF)
    assert patch.status_code == 200 and patch.json()["name"] == "Beta"

    assert client.delete(f"/api/widgets/{wid}", headers=ADMIN).status_code == 204
    gone = client.get(f"/api/widgets/{wid}", headers=ADMIN)
    assert gone.status_code == 404 and gone.json() == {"error": "Widget not found"}


def test_requires_sign_in(client):
    res = client.get("/api/widgets/")
    assert res.status_code == 401 and res.json() == {"error": "Please sign in to continue"}


# pagination


def test_pagination_envelope(catalog):
    res = catalog.get("/api/widgets/?page=2&limit=3", headers=VIEWER).json()
    assert (res["page"], res["limit"], res["total"], res["pages"]) == (2, 3, 8, 3)
    assert [i["name"] for i in res["items"]] == ["Lamp", "Nail", "Saw"]


def test_limit_is_capped_and_default_applies(catalog):
    assert catalog.get("/api/widgets/?limit=500", headers=VIEWER).json()["limit"] == 10
    assert catalog.get("/api/widgets/", headers=VIEWER).json()["limit"] == 5


@pytest.mark.parametrize("query", ["page=0", "page=-1", "limit=0", "limit=abc", "page=x"])
def test_pagination_bounds_rejected(catalog, query):
    res = catalog.get(f"/api/widgets/?{query}", headers=VIEWER)
    assert res.status_code == 400 and "error" in res.json()


def test_page_past_the_end_is_empty(catalog):
    res = catalog.get("/api/widgets/?page=9", headers=VIEWER).json()
    assert res["items"] == [] and res["total"] == 8


# sorting


def test_sorting_ascending_and_descending(catalog):
    assert names(catalog.get("/api/widgets/?sort=price&limit=10", headers=VIEWER))[:3] == ["Nail", "Screw", "Bolt"]
    assert names(catalog.get("/api/widgets/?sort=-price&limit=10", headers=VIEWER))[:2] == ["Saw", "Drill"]


def test_sort_whitelist(catalog):
    res = catalog.get("/api/widgets/?sort=sku", headers=VIEWER)
    assert res.status_code == 400
    assert "Cannot sort by 'sku'" in res.json()["error"]
    assert catalog.get("/api/widgets/?sort=owner_id", headers=VIEWER).status_code == 400


# filters


def test_exact_filter(catalog):
    assert names(catalog.get("/api/widgets/?category=Lighting&limit=10", headers=VIEWER)) == ["Lamp", "Torch"]
    assert catalog.get("/api/widgets/?active=true", headers=VIEWER).json()["total"] == 8
    assert catalog.get("/api/widgets/?active=false", headers=VIEWER).json()["total"] == 0


def test_range_filter(catalog):
    res = catalog.get("/api/widgets/?price__gte=30&price__lte=80&limit=10", headers=VIEWER)
    assert names(res) == ["Hammer", "Lamp", "Torch"]


def test_datetime_range_filter(catalog):
    far_future = catalog.get("/api/widgets/?created_at__gte=2999-01-01", headers=VIEWER)
    assert far_future.json()["total"] == 0
    assert catalog.get("/api/widgets/?created_at__lte=2999-01-01T00:00:00Z", headers=VIEWER).json()["total"] == 8


def test_set_filter(catalog):
    res = catalog.get("/api/widgets/?category__in=Lighting,Hardware&limit=10", headers=VIEWER)
    assert names(res) == ["Bolt", "Lamp", "Nail", "Screw", "Torch"]


def test_custom_filter(catalog):
    assert names(catalog.get("/api/widgets/?expensive=true&limit=10", headers=VIEWER)) == ["Drill", "Saw"]
    bad = catalog.get("/api/widgets/?expensive=maybe", headers=VIEWER)
    assert bad.status_code == 400 and bad.json()["fields"] == {"expensive": "Use true or false"}


def test_filters_combine(catalog):
    res = catalog.get("/api/widgets/?category=Tools&price__lte=100&q=ham", headers=VIEWER)
    assert names(res) == ["Hammer"]


def test_unknown_filter_and_bad_values(catalog):
    unknown = catalog.get("/api/widgets/?owner_id=1", headers=VIEWER)
    assert unknown.status_code == 400 and "Unknown filter 'owner_id'" in unknown.json()["error"]
    assert catalog.get("/api/widgets/?price__gte=cheap", headers=VIEWER).status_code == 400
    assert catalog.get("/api/widgets/?created_at__gte=yesterday", headers=VIEWER).status_code == 400


# search


def test_search_is_case_insensitive_across_fields(catalog):
    assert names(catalog.get("/api/widgets/?q=SCREW", headers=VIEWER)) == ["Screw"]
    assert names(catalog.get("/api/widgets/?q=s-1", headers=VIEWER)) == ["Saw"]


def test_search_treats_wildcards_literally(catalog):
    assert catalog.get("/api/widgets/?q=%25", headers=VIEWER).json()["total"] == 0
    assert catalog.get("/api/widgets/?q=_", headers=VIEWER).json()["total"] == 0


# permissions


def test_permission_matrix(client):
    assert client.post("/api/widgets/", json={"name": "x", "sku": "x", "category": "c", "price": 1},
                       headers=VIEWER).status_code == 403
    mine = make(client, headers=STAFF)
    wid = mine["id"]
    url = f"/api/widgets/{wid}"

    assert client.patch(url, json={"price": 1}, headers=VIEWER).status_code == 403
    assert client.patch(url, json={"price": 1}, headers=OTHER_STAFF).status_code == 403
    assert client.patch(url, json={"price": 2}, headers=STAFF).status_code == 200  # owner
    assert client.patch(url, json={"price": 3}, headers=ADMIN).status_code == 200  # admin

    assert client.delete(url, headers=STAFF).status_code == 403  # owner cannot delete
    assert client.delete(url, headers=VIEWER).status_code == 403
    assert client.delete(url, headers=ADMIN).status_code == 204


def test_forbidden_message_names_the_action(client):
    res = client.post("/api/widgets/", json={"name": "x", "sku": "x", "category": "c", "price": 1}, headers=VIEWER)
    assert res.json() == {"error": "You do not have permission to create this widget"}


# hooks


def test_hooks_fire_in_order(client):
    wid = make(client)["id"]
    assert dummy.CALLS == ["authorize:create", "before_create", "after_create"]

    dummy.CALLS.clear()
    client.patch(f"/api/widgets/{wid}", json={"price": 9}, headers=STAFF)
    assert dummy.CALLS == ["authorize:update", "before_update", "after_update"]

    dummy.CALLS.clear()
    client.delete(f"/api/widgets/{wid}", headers=ADMIN)
    assert dummy.CALLS == ["authorize:delete", "before_delete", "after_delete"]


def test_denied_request_fires_no_write_hooks(client):
    client.post("/api/widgets/", json={"name": "x", "sku": "x", "category": "c", "price": 1}, headers=VIEWER)
    assert dummy.CALLS == ["authorize:create"]


# disabled actions


@pytest.mark.parametrize("method,path", [("post", "/"), ("put", "/1"), ("patch", "/1"), ("delete", "/1")])
def test_disabled_actions_return_405(client, method, path):
    kwargs = {"json": {}} if method in ("post", "put", "patch") else {}
    res = getattr(client, method)(f"/api/readonly-widgets{path}", headers=ADMIN, **kwargs)
    assert res.status_code == 405
    assert "error" in res.json()


def test_enabled_actions_still_work_on_partly_disabled_resource(client):
    make(client)
    assert client.get("/api/readonly-widgets/", headers=VIEWER).json()["total"] == 1


# error mapping


def test_unique_violation_maps_to_409_with_field(client):
    make(client, sku="DUP")
    res = client.post("/api/widgets/", json={"name": "Again", "sku": "DUP", "category": "c", "price": 1}, headers=STAFF)
    assert res.status_code == 409
    assert res.json() == {"error": "Sku already in use", "fields": {"sku": "Already in use"}}


def test_unique_violation_on_update(client):
    make(client, sku="ONE")
    second = make(client, name="Two", sku="TWO")
    res = client.patch(f"/api/widgets/{second['id']}", json={"sku": "ONE"}, headers=STAFF)
    assert res.status_code == 409 and res.json()["fields"] == {"sku": "Already in use"}


def test_validation_errors_map_to_fields(client):
    res = client.post("/api/widgets/", json={"name": "", "sku": "x", "category": "c", "price": -4}, headers=STAFF)
    assert res.status_code == 422
    body = res.json()
    assert body["error"] == "Please fix the highlighted fields"
    assert set(body["fields"]) == {"name", "price"}


def test_malformed_id_is_a_validation_error(client):
    res = client.get("/api/widgets/abc", headers=VIEWER)
    assert res.status_code == 422 and "id" in res.json()["fields"]


def test_unknown_route_uses_error_shape(client):
    assert client.get("/api/nothing").json() == {"error": "Not found"}


# documentation


def test_generated_routes_are_documented(client):
    spec = client.get("/openapi.json").json()
    assert set(spec["paths"]["/api/widgets/"]) == {"get", "post"}
    assert set(spec["paths"]["/api/widgets/{id}"]) == {"get", "put", "patch", "delete"}

    listing = spec["paths"]["/api/widgets/"]["get"]
    assert listing["summary"] == "List widgets"
    params = {p["name"] for p in listing["parameters"]}
    assert {"page", "limit", "sort", "q", "category", "price__gte", "price__lte", "category__in", "expensive"} <= params
    assert {"200", "400", "401", "403"} <= set(listing["responses"])
    assert "201" in spec["paths"]["/api/widgets/"]["post"]["responses"]
    assert "204" in spec["paths"]["/api/widgets/{id}"]["delete"]["responses"]
    assert "/api/readonly-widgets/{id}" in spec["paths"]
    assert set(spec["paths"]["/api/readonly-widgets/{id}"]) == {"get"}
