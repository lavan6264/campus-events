"""Builds postman/campus-events.json from the API's own OpenAPI spec.

Run from backend/:  python scripts/make_postman.py
The collection logs in once (the "Login" request stores the token) and every other
request sends it as a bearer token. Sample bodies are filled in from the schemas.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402

SAMPLES = {
    "string": "text",
    "integer": 1,
    "number": 1,
    "boolean": True,
}
OVERRIDES = {
    "email": "admin@campus-demo.test",
    "password": "admin123",
    "query": "robotics workshops next week",
    "notes": "robotics intro session, friday afternoon, innovation lab, bring laptop",
    "title": "Intro to robotics",
    "category": "Workshop",
    "venue": "Innovation Lab",
    "start_time": "2030-05-01T10:00:00Z",
    "end_time": "2030-05-01T13:00:00Z",
    "capacity": 30,
    "role": "student",
    "name": "Asha Rao",
    "description": "A hands on session. Bring a laptop.",
}


def resolve(schema, spec):
    if "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        return resolve(spec["components"]["schemas"][name], spec)
    return schema


def sample(schema, spec, name=""):
    schema = resolve(schema, spec)
    for option in schema.get("anyOf", []) + schema.get("oneOf", []):
        if option.get("type") != "null":
            return sample(option, spec, name)
    if name in OVERRIDES:
        return OVERRIDES[name]
    kind = schema.get("type")
    if kind == "object":
        return {k: sample(v, spec, k) for k, v in schema.get("properties", {}).items()}
    if kind == "array":
        return [sample(schema.get("items", {}), spec, name)]
    if "enum" in schema:
        return schema["enum"][0]
    return SAMPLES.get(kind, "text")


def build():
    spec = create_app().openapi()
    folders: dict[str, list] = {}
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            tag = (op.get("tags") or ["Other"])[0]
            url_path = path.replace("{id}", "1")
            query = [
                {"key": p["name"], "value": "", "disabled": True, "description": p.get("description", "")}
                for p in op.get("parameters", []) if p["in"] == "query"
            ]
            item = {
                "name": f"{method.upper()} {path.replace('/api', '')}  {op.get('summary', '')}".strip(),
                "request": {
                    "method": method.upper(),
                    "header": [{"key": "Content-Type", "value": "application/json"}],
                    "url": {
                        "raw": "{{baseUrl}}" + url_path,
                        "host": ["{{baseUrl}}"],
                        "path": [p for p in url_path.split("/") if p],
                        "query": query,
                    },
                    "description": (op.get("description") or op.get("summary") or "").strip(),
                },
            }
            body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
            if body:
                item["request"]["body"] = {
                    "mode": "raw",
                    "raw": json.dumps(sample(body, spec), indent=2),
                    "options": {"raw": {"language": "json"}},
                }
            if path in ("/api/auth/login", "/api/auth/register"):
                item["request"]["auth"] = {"type": "noauth"}
                item["event"] = [{
                    "listen": "test",
                    "script": {"type": "text/javascript", "exec": [
                        "const body = pm.response.json();",
                        "if (body.access_token) { pm.collectionVariables.set('token', body.access_token); }",
                    ]},
                }]
            folders.setdefault(tag, []).append(item)

    order = ["Auth", "Events", "Registrations", "Me", "Users", "Admin", "AI", "health"]
    items = [{"name": t, "item": folders[t]} for t in order if t in folders]
    items += [{"name": t, "item": v} for t, v in folders.items() if t not in order]
    return {
        "info": {
            "name": "Campus Events API",
            "description": "Run Auth > POST /auth/login first. It stores the token, and every other request uses it.",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}", "type": "string"}]},
        "variable": [
            {"key": "baseUrl", "value": "http://localhost:8000"},
            {"key": "token", "value": ""},
        ],
        "item": items,
    }


if __name__ == "__main__":
    target = ROOT.parent / "postman" / "campus-events.json"
    target.parent.mkdir(exist_ok=True)
    collection = build()
    target.write_text(json.dumps(collection, indent=2), encoding="utf-8")
    count = sum(len(f["item"]) for f in collection["item"])
    print(f"Wrote {target} with {count} requests in {len(collection['item'])} folders")
