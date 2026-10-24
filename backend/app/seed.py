"""Demo data. Run with: python -m app.seed

Wipes users, events and registrations, then recreates them. Deterministic
(fixed random seed) except for dates, which are relative to the current time.
"""
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

import app.models  # noqa: F401
from app.db import SessionLocal
from app.resources.events.models import Event
from app.resources.registrations.models import Registration
from app.resources.users.models import User
from app.security import hash_password

DOMAIN = "campus-demo.test"
DEPARTMENTS = [
    "School of Engineering",
    "School of Management",
    "School of Sciences",
    "School of Arts and Humanities",
    "School of Law",
]
VENUES = ["Main Auditorium", "Seminar Hall", "Innovation Lab", "Sports Ground", "Open Amphitheatre"]

ADMIN = ("Rajesh Menon", "School of Management")
FACULTY = [
    ("Dr. Meenakshi Iyer", "School of Engineering"),
    ("Prof. Arvind Kulkarni", "School of Sciences"),
    ("Dr. Sunita Banerjee", "School of Arts and Humanities"),
    ("Prof. Imran Qureshi", "School of Law"),
]
STUDENTS = [
    "Aarav Sharma", "Ananya Reddy", "Vihaan Patel", "Diya Nair", "Arjun Mehta",
    "Isha Gupta", "Kabir Singh", "Meera Krishnan", "Rohan Desai", "Saanvi Joshi",
    "Aditya Verma", "Kavya Menon", "Siddharth Rao", "Pooja Chatterjee", "Nikhil Bhat",
    "Riya Kapoor", "Harsh Agarwal", "Tanvi Kulkarni", "Yash Malhotra", "Neha Pillai",
    "Karthik Subramanian", "Aisha Khan", "Varun Chopra", "Shreya Iyer", "Manish Yadav",
    "Lakshmi Narayanan", "Devansh Tiwari", "Ritika Sen", "Pranav Hegde", "Simran Kaur",
    "Abhishek Mishra", "Sneha Bose", "Tarun Naidu", "Jhanvi Saxena", "Omkar Patil",
    "Fatima Sheikh", "Gaurav Pandey", "Anjali Das", "Ishaan Bajaj", "Divya Shetty",
]

# (title, category, venue index, organizer index (0 = admin, 1-4 faculty), day offset,
#  start hour, hours, capacity, kind)
EVENTS = [
    ("Intro to robotics workshop", "Workshop", 2, 1, -18, 10, 3, 40, "past"),
    ("Research methods seminar", "Seminar", 1, 2, -15, 14, 2, 60, "past"),
    ("Inter-school football league", "Sports", 3, 3, -12, 16, 3, 80, "past"),
    ("Hack the campus", "Competition", 2, 1, -10, 9, 8, 50, "past"),
    ("Classical dance evening", "Cultural", 4, 3, -8, 18, 3, 120, "past"),
    ("Debating society open meet", "Club Meet", 1, 4, -5, 17, 2, 35, "past"),
    ("Moot court practice session", "Workshop", 1, 4, -3, 11, 2, 30, "past"),
    ("Data science with Python", "Workshop", 2, 1, 2, 10, 4, 45, "upcoming"),
    ("Startup funding seminar", "Seminar", 0, 2, 3, 15, 2, 150, "upcoming"),
    ("Robotics line follower contest", "Competition", 2, 1, 4, 9, 6, 40, "upcoming"),
    ("Annual cultural fest auditions", "Cultural", 4, 3, 5, 16, 3, 100, "upcoming"),
    ("Cricket trials", "Sports", 3, 2, 6, 7, 3, 60, "upcoming"),
    ("Photography club walk", "Club Meet", 4, 3, 7, 6, 2, 30, "upcoming"),
    ("Cyber law awareness talk", "Seminar", 1, 4, 9, 11, 2, 80, "upcoming"),
    ("Web development bootcamp", "Workshop", 2, 1, 11, 10, 6, 35, "upcoming"),
    ("Quiz night", "Competition", 0, 0, 13, 18, 2, 120, "upcoming"),
    ("Literature reading circle", "Club Meet", 1, 3, 16, 17, 2, 30, "upcoming"),
    ("Embedded systems workshop", "Workshop", 2, 1, 8, 10, 4, 6, "full"),
    ("Open mic night", "Cultural", 4, 3, 10, 18, 3, 8, "full"),
    ("Table tennis doubles", "Sports", 3, 2, 12, 15, 3, 5, "full"),
]
FULL_WAITLIST = {"Embedded systems workshop": 3, "Open mic night": 2, "Table tennis doubles": 3}
TARGET_REGISTRATIONS = 250


def main() -> None:
    rng = random.Random(42)
    now = datetime.now(timezone.utc)

    with SessionLocal() as db:
        db.execute(text("TRUNCATE registrations, events, users RESTART IDENTITY CASCADE"))

        admin_pw = hash_password("admin123")
        faculty_pw = hash_password("faculty123")
        student_pw = hash_password("student123")

        def email_for(name: str) -> str:
            cleaned = name.replace("Dr. ", "").replace("Prof. ", "").lower()
            return ".".join(cleaned.split()) + "@" + DOMAIN

        users: list[User] = [
            User(name="Admin", email=f"admin@{DOMAIN}", password_hash=admin_pw,
                 role="admin", department=ADMIN[1])
        ]
        for i, (name, dept) in enumerate(FACULTY, start=1):
            users.append(User(name=name, email=f"faculty{i}@{DOMAIN}", password_hash=faculty_pw,
                              role="faculty", department=dept))
        students: list[User] = []
        for i, name in enumerate(STUDENTS):
            students.append(User(name=name, email=email_for(name), password_hash=student_pw,
                                 role="student", department=DEPARTMENTS[i % len(DEPARTMENTS)]))
        db.add_all(users + students)
        db.flush()

        events: list[Event] = []
        kinds: dict[int, str] = {}
        for title, cat, venue, org, offset, hour, hours, cap, kind in EVENTS:
            start = (now + timedelta(days=offset)).replace(hour=hour, minute=0, second=0, microsecond=0)
            created = max(start - timedelta(days=rng.randint(5, 12)), now - timedelta(days=30))
            ev = Event(
                title=title, category=cat, venue=VENUES[venue], start_time=start,
                end_time=start + timedelta(hours=hours), capacity=cap, organizer_id=users[org].id,
                status="published", created_at=created,
                description=f"{title} at the {VENUES[venue]}. Open to all students and faculty.",
            )
            events.append(ev)
        db.add_all(events)
        db.flush()
        for ev, row in zip(events, EVENTS):
            kinds[ev.id] = row[8]

        # In-memory bookkeeping so the seed itself respects the clash and unique rules.
        taken: set[tuple[int, int]] = set()
        confirmed: dict[int, list[Event]] = {}
        added = 0

        def overlaps(a: Event, b: Event) -> bool:
            return a.start_time < b.end_time and b.start_time < a.end_time

        def add(user: User, ev: Event, status: str, created_at: datetime) -> bool:
            nonlocal added
            if (user.id, ev.id) in taken:
                return False
            if status == "registered" and any(overlaps(ev, o) for o in confirmed.get(user.id, [])):
                return False
            taken.add((user.id, ev.id))
            if status == "registered":
                confirmed.setdefault(user.id, []).append(ev)
            db.add(Registration(event_id=ev.id, user_id=user.id, status=status,
                                created_at=created_at, updated_at=created_at))
            added += 1
            return True

        def reg_time(ev: Event, after: datetime | None = None) -> datetime:
            low = max(ev.created_at, now - timedelta(days=30), after or ev.created_at)
            high = min(now - timedelta(minutes=5), ev.start_time - timedelta(hours=1))
            if high <= low:
                return low
            return low + (high - low) * rng.random()

        # 1. Full events: fill every seat, then add a waitlist behind them.
        for ev in events:
            if kinds[ev.id] != "full":
                continue
            pool = rng.sample(students, len(students))
            seated = 0
            last = ev.created_at
            for s in pool:
                if seated == ev.capacity:
                    break
                t = reg_time(ev, last)
                if add(s, ev, "registered", t):
                    seated += 1
                    last = max(last, t)
            waiting = 0
            for s in pool:
                if waiting == FULL_WAITLIST[ev.title]:
                    break
                if add(s, ev, "waitlisted", reg_time(ev, last)):
                    waiting += 1

        # 2. Past events get most of the volume, a few cancellations included.
        # 3. Remaining upcoming events fill up to the target.
        open_events = [e for e in events if kinds[e.id] in ("past", "upcoming")]
        weights = [3 if kinds[e.id] == "past" else 2 for e in open_events]
        attempts = 0
        while added < TARGET_REGISTRATIONS and attempts < 20000:
            attempts += 1
            ev = rng.choices(open_events, weights)[0]
            user = rng.choice(students)
            status = "cancelled" if rng.random() < 0.04 else "registered"
            add(user, ev, status, reg_time(ev))

        db.commit()

        print(f"Seeded {len(users) + len(students)} users, {len(events)} events, {added} registrations.\n")
        print("Demo logins")
        print(f"  admin    admin@{DOMAIN} / admin123")
        print(f"  faculty  faculty1@{DOMAIN} / faculty123  (faculty1 to faculty4)")
        print(f"  student  {students[0].email} / student123  (all students use student123)")


if __name__ == "__main__":
    main()
