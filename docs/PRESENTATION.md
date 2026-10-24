# Campus Events: presentation outline

About 5 minutes. Twelve slides, three of them live demo. Each slide has what goes on it, what to say, and a cue. Screenshots are in `docs/screenshots/`. Before you start: both servers running, the database freshly seeded (`python -m app.seed`), and the sign in page open.

---

## 1. Title (10 s)
**On the slide:** Campus Events. One place to create, find and join campus events. Logo.
**Say:** "This is Campus Events, a system for students, organisers and admins to run campus events end to end."

## 2. The problem (25 s)
**On the slide:** Three short lines: duplicate registrations. Rooms booked twice. No view of participation.
**Say:** "Universities run many events. Registering by hand means duplicate entries, two groups in one room, and nobody knowing how well events do."

## 3. The flow (15 s)
**On the slide:** Login, Dashboard, Create or Explore, Register, Manage Participants, View Reports. One line of arrows.
**Say:** "Here is the journey we built. I will show it live in a moment."

## 4. Who uses it (20 s)
**On the slide:** Student, Organiser, Admin with one line each.
**Say:** "Three roles. Students enrol. Organisers create events and manage their people. Admins see everything and manage roles."

## 5. Live demo, part 1: student (60 s)
**Do:** Sign in with the Student demo button. Show the dashboard cards and the figures strip. Open Explore, filter by category, point at the URL changing. Switch to "Describe what you want", type `robotics workshops next week`, press Find events. Press Enroll on a card.
**Say:** "Cards show the date, venue, seats left and one clear action. The AI search turns a sentence into the same filters the list already uses, and tells you whether the AI or a keyword fallback answered."
**Cue:** If the AI is slow, say "that is the 5-second limit and the fallback working."

## 6. Live demo, part 2: organiser (70 s)
**Do:** Sign out, use the Organiser button, open My events, press Create event. Type rough notes into Draft with AI and press it. Upload a cover image. Make the end earlier than the start to show the inline error. Pick a room that is already booked to show the venue warning. Fix and save.
**Say:** "The organiser gets an AI draft, but nothing saves until they decide. The form warns if the room is already taken, and the server enforces it even if two organisers save at the same second."

## 7. Live demo, part 3: participants and reports (60 s)
**Do:** Open Manage participants, search, press Export CSV. Raise the capacity of the full event so the waitlist moves up. Then sign in as Admin and open Reports: the figures, the AI summary, a chart hovered, View as table, the role selector.
**Say:** "Waitlists promote automatically. Reports are hand-built charts, each readable as a table, and the summary is checked so it can only use numbers from the data."

## 8. How it is built (25 s)
**On the slide:** The stack table: FastAPI, PostgreSQL, SQLAlchemy and Alembic, React and Vite, Gemini.
**Say:** "Python and FastAPI on PostgreSQL, React on the front. Migrations for every table change."

## 9. The core idea: a reusable CRUD framework (30 s)
**On the slide:** A small diagram: framework layer, resource layer, domain routes. The words "about 20 lines per resource".
**Say:** "The framework generates the routes, the pagination, sorting, search and filters, the permissions and one error format. Users, events and registrations sit on top of it. Adding a new resource takes about twenty lines, and the README shows the example, which is run as a real test."

## 10. The hard problems (30 s)
**On the slide:** Four lines: last seat, waitlist, time clash, room double booking.
**Say:** "Two people clicking the last seat: we lock the event row, and the tests prove only one gets in. A person cannot hold two overlapping events. A room cannot hold two events at once, even when two organisers save together."

## 11. Quality (20 s)
**On the slide:** Over 200 backend tests, over 100 frontend tests, a real-browser walkthrough, an accessibility audit, contrast checked in both themes.
**Say:** "I tested the failure cases too: I removed the locks to confirm the concurrency tests actually fail without them."

## 12. What is next (15 s)
**On the slide:** Object storage and image resizing. Email reminders. A shared limiter for several servers.
**Say:** "Honest limits: uploads are stored locally and the login limiter is in memory. Those are the first things to change for a real deployment. Thank you."

---

## If you are asked

- **Why not a CSS framework or component library?** The design needed to be fully custom and consistent, and the tokens let us switch between dark and light and between whole palettes by changing one file.
- **What if the AI is down?** Every AI feature has a plain fallback and says so on screen. Nothing depends on it.
- **How do you stop double booking under load?** A transaction with row locks for seats and a database advisory lock per venue.
- **Why is the role called faculty in the database?** Renaming the stored value would need a data migration for no visible gain, so it shows as Organiser in the interface.
- **Demo logins:** Admin `admin@campus-demo.test` / `admin123`. Organiser `organiser1@campus-demo.test` / `organiser123`. Student `aarav.sharma@campus-demo.test` / `student123`.
