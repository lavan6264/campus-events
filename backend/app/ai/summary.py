"""Admin analytics summary. The model may only restate numbers that are in the stats payload."""
import json
import re
from datetime import timedelta

from pydantic import BaseModel, Field

from app.ai.client import generate_json
from app.domain.admin import Stats

SYSTEM = (
    "You write a short analytics summary for a campus events administrator. "
    "Use only the numbers in the data you are given, never calculate new ones, and never invent facts. "
    "Plain sentences, no emojis, no marketing buzzwords. Reply with JSON only."
)


class _ModelSummary(BaseModel):
    sentences: list[str] = Field(min_length=1, max_length=8)


class SummaryResult(BaseModel):
    source: str
    sentences: list[str]
    summary: str


def _window_sums(stats: Stats) -> tuple[int, int]:
    days = stats.registrations_per_day
    last = sum(d.registrations for d in days[-7:])
    previous = sum(d.registrations for d in days[-14:-7])
    return last, previous


def payload_for(stats: Stats) -> dict:
    """A compact view of the stats. This is the complete set of facts the model can use."""
    last, previous = _window_sums(stats)
    return {
        "totals": stats.totals.model_dump(),
        "registrations_last_7_days": last,
        "registrations_previous_7_days": previous,
        "categories": [c.model_dump() for c in stats.registrations_per_category],
        "top_events": [
            {"title": e.title, "category": e.category, "registered": e.registered,
             "capacity": e.capacity, "fill_rate": e.fill_rate}
            for e in stats.top_events
        ],
        "upcoming_events_near_capacity": [
            {"title": e.title, "registered": e.registered, "capacity": e.capacity, "fill_rate": e.fill_rate}
            for e in stats.near_capacity
        ],
        "registrations_by_role": [r.model_dump() for r in stats.registrations_by_role],
    }


_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _numbers(text: str) -> set[float]:
    return {float(n) for n in _NUMBER.findall(text)}


def only_known_numbers(sentences: list[str], payload: dict) -> bool:
    allowed = _numbers(json.dumps(payload, default=str)) | {7.0, 30.0}  # "last 7 days", "last 30 days"
    return all(n in allowed for s in sentences for n in _numbers(s))


def _clean(sentences: list[str]) -> list[str]:
    return [" ".join(s.split()) for s in sentences if s.strip()]


def _num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def fallback_sentences(stats: Stats) -> list[str]:
    t = stats.totals
    last, previous = _window_sums(stats)
    out = [
        f"There are {t.confirmed_registrations} confirmed registrations across {t.published_events} published "
        f"events, filling {_num(t.fill_rate)}% of {t.capacity} seats."
    ]
    if last > previous:
        out.append(f"Registrations are growing: {last} in the last 7 days against {previous} in the 7 days before.")
    elif last < previous:
        out.append(f"Registrations are slowing: {last} in the last 7 days against {previous} in the 7 days before.")
    else:
        out.append(f"Registrations are steady at {last} in each of the last two weeks.")
    if stats.near_capacity:
        names = ", ".join(f"{e.title} ({_num(e.fill_rate)}% full)" for e in stats.near_capacity[:3])
        out.append(f"Upcoming events near capacity: {names}.")
    else:
        out.append("No upcoming event is near capacity.")
    active = [c for c in stats.registrations_per_category if c.events > 0]
    empty = [c.category for c in stats.registrations_per_category if c.events == 0]
    if active:
        lowest = min(active, key=lambda c: (c.fill_rate, c.category))
        out.append(f"{lowest.category} is the least used category with seats {_num(lowest.fill_rate)}% filled.")
    if empty:
        out.append(f"No events are scheduled in {', '.join(empty)}.")
    elif t.waitlisted_registrations:
        out.append(f"{t.waitlisted_registrations} people are on a waitlist.")
    return out[:5]


def summarize(stats: Stats) -> SummaryResult:
    payload = payload_for(stats)
    prompt = (
        "Write 4 to 5 plain sentences for the admin: what is growing, which events are near capacity, "
        "and which categories are underused. Compare registrations_last_7_days with "
        "registrations_previous_7_days for growth. Keep each sentence under 20 words.\n\n"
        f"Data:\n{json.dumps(payload, default=str)}"
    )
    result = generate_json(prompt, _ModelSummary, system=SYSTEM)
    if result is not None:
        sentences = _clean(result.sentences)
        if 4 <= len(sentences) <= 5 and only_known_numbers(sentences, payload):
            return SummaryResult(source="ai", sentences=sentences, summary=" ".join(sentences))
    sentences = fallback_sentences(stats)
    return SummaryResult(source="fallback", sentences=sentences, summary=" ".join(sentences))
