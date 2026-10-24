# Campus Events

Smart Campus Event Management System. FastAPI + PostgreSQL + React.

The full README (architecture, API, framework guide, demo script) is written in the final phase. This file covers setup only for now.

## Setup

```
cp .env.example .env && cp .env.example backend/.env
docker compose up -d db
cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m app.seed
.venv/Scripts/python -m uvicorn app.main:app --port 8000     # API and /docs
cd ../frontend && npm install && npm run dev                 # http://localhost:5173
```

The database listens on host port **5433** (container port 5432), so it does not clash with a local PostgreSQL install. Change `POSTGRES_PORT` and the two database URLs in `.env` if you prefer another port.

`docker-compose.yml` creates two databases on first start: `campus_events` and `campus_events_test` (used by pytest).

## Decisions

- PostgreSQL 16 runs only through Docker Compose, with a named volume.
- Git is local only. No remote, no CI workflows.
- Python: the code targets 3.12 or newer. It was developed on 3.13.
- Roles and status columns are `VARCHAR` with `CHECK` constraints instead of native PostgreSQL enums, which keeps migrations simple.
- A user cannot hold two confirmed registrations whose time ranges overlap. Waitlisted registrations are ignored by this check. If a waitlisted user is promoted into an event that overlaps another confirmed event of theirs, the promotion stays and both events show a clash notice.
- Only an admin can change a user's role, through `PATCH /admin/users/{id}/role`. Faculty cannot promote anyone, users cannot change their own role, and an admin cannot remove their own admin role.
- AI features use the Google AI Studio (Gemini) API with deterministic fallbacks.
- `python -m app.seed` wipes users, events and registrations before recreating them.
- Frontend `VITE_*` settings are read from the repo root `.env` (Vite `envDir` is the parent folder), so one file configures both sides.
- The frontend fonts (IBM Plex Sans and Mono) are self-hosted through the `@fontsource` packages, so the build has no external requests.
- Glass fallbacks: add `data-glass="off"` to `<html>` to force the opaque surfaces. The same variables are used by `@supports not (backdrop-filter)` and `prefers-reduced-transparency`. Screenshots of both modes are in `docs/screenshots`.
- Gemini: the default model is `gemini-3.5-flash-lite` because the larger Flash models were often overloaded during development. The 5 second limit is enforced in our code, since the API refuses a server side deadline under 10 seconds.
- Search in the top bar has a visually hidden label plus a visible placeholder, because a slim bar has no room for a label above the field. All other fields have visible labels.
