# Campus Events

Smart Campus Event Management System. FastAPI + PostgreSQL + React.

The full README (architecture, API, framework guide, demo script) is written in the final phase. This file covers setup only for now.

## Setup (backend, phase 1)

```
cp .env.example .env && cp .env.example backend/.env
docker compose up -d db
cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m app.seed
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
