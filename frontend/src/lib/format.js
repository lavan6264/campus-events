const LOCALE = "en-IN";

const dateTime = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });
const time = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });
const full = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const formatDateTime = (iso) => dateTime.format(new Date(iso));
export const formatDayMonth = (iso) => dayMonth.format(new Date(iso));
export const formatWeekday = (iso) => weekday.format(new Date(iso));
export const formatTime = (iso) => time.format(new Date(iso));
export const formatFullDate = (iso) => full.format(new Date(iso));

export function formatTimeRange(startIso, endIso) {
  return `${formatTime(startIso)} to ${formatTime(endIso)}`;
}

export const hasEnded = (event) => new Date(event.end_time) <= new Date();

/** "12 seats left", "Full", "Registration closed" and so on, in the words a student expects. */
export function seatsText(event) {
  if (event.status === "cancelled") return "Cancelled";
  if (hasEnded(event)) return "Ended";
  if (event.seats_left <= 0) return event.waitlisted_count ? `Full, ${event.waitlisted_count} waiting` : "Full";
  return `${event.seats_left} ${event.seats_left === 1 ? "seat" : "seats"} left`;
}
