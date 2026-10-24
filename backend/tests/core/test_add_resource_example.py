"""The worked example from the README, 'Add a new resource in 20 lines', run for real.

The only differences from the README are the table name and the stand-in login, because this
file must not touch the real users table.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict, Field

from app.core.crud import CRUDConfig, CRUDService, Exact, Perm, Range, crud_router, install_error_handlers
from app.db import get_db
from tests.core.dummy import Venue, current_user


class VenueIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    capacity: int = Field(gt=0)


class VenueRead(VenueIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class VenueUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    capacity: int | None = Field(default=None, gt=0)


class VenueService(CRUDService[Venue, VenueIn, VenueUpdate]):
    model = Venue


router = crud_router(CRUDConfig(
    prefix="/venues", tags=["Venues"], model=Venue, read_schema=VenueRead,
    create_schema=VenueIn, update_schema=VenueUpdate, service=VenueService, current_user=current_user,
    permissions={"list": Perm(), "read": Perm(), "create": Perm(roles=("admin",)),
                 "update": Perm(roles=("admin",)), "delete": Perm(roles=("admin",))},
    filters=[Exact("name"), Range("capacity")], search_fields=["name"],
    sortable_fields=["name", "capacity"], default_sort="name",
))

ADMIN = {"X-Role": "admin"}
USER = {"X-Role": "student"}


@pytest.fixture()
def client(override_db):
    app = FastAPI()
    install_error_handlers(app)
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_a_new_resource_gets_every_route_and_the_query_convention(client):
    for name, capacity in [("Seminar Hall", 80), ("Innovation Lab", 40), ("Main Auditorium", 400)]:
        assert client.post("/api/venues/", json={"name": name, "capacity": capacity}, headers=ADMIN).status_code == 201

    listing = client.get("/api/venues/?capacity__lte=100&sort=-capacity&q=LAB", headers=USER).json()
    assert [v["name"] for v in listing["items"]] == ["Innovation Lab"]
    assert (listing["page"], listing["limit"], listing["total"], listing["pages"]) == (1, 12, 1, 1)
    assert client.get("/api/venues/?limit=2", headers=USER).json()["pages"] == 2
    assert client.get("/api/venues/?floor=3", headers=USER).status_code == 400  # not a declared filter

    venue_id = listing["items"][0]["id"]
    assert client.patch(f"/api/venues/{venue_id}", json={"capacity": 50}, headers=ADMIN).json()["capacity"] == 50
    assert client.patch(f"/api/venues/{venue_id}", json={"capacity": 50}, headers=USER).status_code == 403
    assert client.post("/api/venues/", json={"name": "Seminar Hall", "capacity": 5}, headers=ADMIN).status_code == 409
    assert client.delete(f"/api/venues/{venue_id}", headers=ADMIN).status_code == 204


def test_it_shows_up_in_the_docs_with_filters(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert set(paths["/api/venues/"]) == {"get", "post"}
    names = {p["name"] for p in paths["/api/venues/"]["get"]["parameters"]}
    assert {"page", "limit", "sort", "q", "name", "capacity__gte", "capacity__lte"} <= names
