# Campus Events: project overview

**Problem.** Universities run many events, workshops and competitions. Registration by hand leads to duplicate entries, overbooked rooms and no clear view of participation. Campus Events is one place to create, find and register for events, manage participants and see reports.

**The flow it delivers.** Login, Event Dashboard, Create or Explore Events, Register, Manage Participants, View Reports.

## What people can do

| Role | Can do |
|---|---|
| Student | Search and filter events, enrol, join a waitlist, cancel, see their own registrations |
| Organiser | Everything a student can, plus create, edit, duplicate and cancel their own events, upload a cover image, see and search participants, export a CSV, remove a participant |
| Admin | Everything, for any event, plus reports, an AI summary and role management |

## How it is built

| Layer | Choice |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy 2.0, Alembic migrations, Pydantic v2 |
| Database | PostgreSQL 16 (Docker) |
| Auth | JWT, bcrypt, login rate limit |
| AI | Google AI Studio (Gemini) with a fallback for every feature |
| Frontend | React 18, Vite, React Router, TanStack Query, plain CSS design tokens |
| Quality | About 200 backend tests and 100 frontend tests, a real-browser walkthrough, an accessibility audit |

**The core idea is a reusable CRUD framework**, written once for the backend and once for the frontend. It generates the list, read, create, update and delete routes, the same pagination, sort, search and filter rules, permissions by role and ownership, and one error format. Users, events and registrations are built on it, and a new resource takes about 20 lines.

## The hard parts, and how they are handled

- **Two people take the last seat at once.** Registration locks the event row inside one transaction, so only one gets in. Tests run 10 simultaneous registrations for one seat and always get exactly one.
- **Event is full.** New registrations go on a waitlist. A cancellation, or a capacity increase, promotes the oldest waiting person automatically.
- **A person cannot be in two places.** Two confirmed registrations may not overlap in time, and the message names the clashing event.
- **A room cannot be double booked.** Two organisers cannot hold the same venue at the same time. The check ignores capital letters and extra spaces, a database lock settles two saves at the same instant, the form warns before saving, and only an admin can override.
- **AI that can fail safely.** Every AI answer is validated, has a 5-second limit and a plain fallback, and tells the screen whether the AI or the fallback produced it. The admin summary is rejected if it contains a number that is not in the data.

## AI features

1. Search in plain language ("robotics workshops next week") that becomes the same filters the list uses.
2. A draft assistant that writes a title, description and category from rough notes. Nothing is saved until the organiser presses save.
3. Recommendations based on past registrations.
4. An admin summary in plain sentences.

## Design and accessibility

Graphite surfaces with an orange accent, in a dark and a light theme that follows the system setting. Events appear as cards with a cover, a seat meter and one clear action. Status is always a text label plus a differently shaped marker, never colour alone. Every colour pair is checked against WCAG AA contrast in both themes, and the audit finds no overflow, no small touch targets and no axe violations from 360px to 1440px.

## Security

Passwords are hashed and never returned. Tokens expire. CORS is limited to the frontend. Filters, sort fields and uploads are whitelisted, and uploads are checked by their real content (SVG is refused). There is no string-built SQL. CSV exports neutralise spreadsheet formulas.

## Honest limits

- Uploaded images are stored in a local folder and are not resized. A real deployment would use object storage.
- The login limiter is in memory, which suits a single server.
- The organiser role is stored as `faculty` in the database and shown as Organiser in the interface.

## Where to look

`README.md` has setup, architecture and ER diagrams, the API summary, the 20-line resource example and the demo script. `docs/screenshots/` has the visuals. `postman/campus-events.json` has every API request.
