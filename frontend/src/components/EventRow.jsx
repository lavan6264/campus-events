import { Link } from "react-router-dom";
import { formatDayMonth, formatTimeRange, formatWeekday, hasEnded, seatsText } from "../lib/format.js";
import StatusMarker from "./StatusMarker.jsx";
import styles from "./EventRow.module.css";

/** Availability in words, with a marker for the user's own state. Never colour alone. */
export function Availability({ event }) {
  if (event.status === "cancelled") return <StatusMarker status="cancelled" />;
  if (event.my_status) {
    const label =
      event.my_status === "waitlisted" && event.my_waitlist_position
        ? `Waitlisted, position ${event.my_waitlist_position}`
        : undefined;
    return <StatusMarker status={event.my_status} label={label} />;
  }
  if (hasEnded(event)) return <StatusMarker status="ended" />;
  if (event.seats_left <= 0) return <StatusMarker status="full" label={seatsText(event)} />;
  return <span className="mono small">{seatsText(event)}</span>;
}

/** A list row: date on the left, title and place in the middle, availability on the right. */
export default function EventRow({ event, children }) {
  return (
    <li className={styles.row}>
      <div className={styles.date} aria-hidden="true">
        <span className="mono">{formatDayMonth(event.start_time)}</span>
        <span className="small muted">{formatWeekday(event.start_time)}</span>
      </div>
      <div className={styles.body}>
        <Link to={`/events/${event.id}`} className={styles.title}>
          {event.title}
        </Link>
        <p className="small muted">
          <span className="mono">{formatTimeRange(event.start_time, event.end_time)}</span>, {event.venue}
        </p>
        {children}
      </div>
      <div className={styles.side}>
        <Availability event={event} />
      </div>
    </li>
  );
}
