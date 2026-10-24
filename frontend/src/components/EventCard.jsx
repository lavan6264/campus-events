import { Link } from "react-router-dom";
import { formatDayMonth, formatTimeRange, formatWeekday, hasEnded } from "../lib/format.js";
import { useCancelRegistration, useRegister } from "../resources/actions.js";
import Button from "./Button.jsx";
import EventCover from "./EventCover.jsx";
import StatusMarker from "./StatusMarker.jsx";
import styles from "./EventCard.module.css";

/** One event: cover, date, where and when, how many seats, and the one action that makes sense. */
function Action({ event }) {
  const register = useRegister();
  const cancel = useCancelRegistration();
  const busy = register.isPending || cancel.isPending;
  const name = event.title;

  if (event.status === "cancelled") return <Button disabled>Cancelled</Button>;
  if (hasEnded(event)) return <Button disabled>Event ended</Button>;

  if (event.my_status === "registered") {
    return (
      <Button variant="danger" onClick={() => cancel.mutate(event.id)} disabled={busy} aria-label={`Cancel enrollment in ${name}`}>
        {cancel.isPending ? "Cancelling" : "Cancel enrollment"}
      </Button>
    );
  }
  if (event.my_status === "waitlisted") {
    return (
      <Button onClick={() => cancel.mutate(event.id)} disabled={busy} aria-label={`Leave the waitlist for ${name}`}>
        {cancel.isPending ? "Leaving" : "Leave waitlist"}
      </Button>
    );
  }
  if (event.seats_left <= 0) {
    return (
      <Button onClick={() => register.mutate(event.id)} disabled={busy} aria-label={`Join the waitlist for ${name}`}>
        {register.isPending ? "Joining" : "Join waitlist"}
      </Button>
    );
  }
  if (event.clash_with_title) {
    return (
      <Button variant="primary" disabled title={`Clashes with ${event.clash_with_title}`} aria-label={`Enroll in ${name}, unavailable: clashes with ${event.clash_with_title}`}>
        Enroll
      </Button>
    );
  }
  return (
    <Button variant="primary" onClick={() => register.mutate(event.id)} disabled={busy} aria-label={`Enroll in ${name}`}>
      {register.isPending ? "Enrolling" : "Enroll"}
    </Button>
  );
}

function Seats({ event }) {
  const taken = Math.min(event.registered_count, event.capacity);
  const percent = Math.round((taken / event.capacity) * 100);
  const full = event.seats_left <= 0;
  return (
    <div className={styles.seats}>
      <div className={styles.meter} role="img" aria-label={`${taken} of ${event.capacity} seats taken`}>
        <span className={`${styles.meterFill} ${full ? styles.meterFull : ""}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="small">
        {event.status === "cancelled" || hasEnded(event) ? (
          <span className="muted">
            <span className="mono">{taken}</span> of <span className="mono">{event.capacity}</span> seats were taken
          </span>
        ) : full ? (
          <span className={styles.fullText}>
            Full{event.waitlisted_count ? `, ${event.waitlisted_count} waiting` : ""}
          </span>
        ) : (
          <>
            <span className="mono">{event.seats_left}</span> {event.seats_left === 1 ? "seat" : "seats"} left
            <span className="muted">
              {" "}
              of <span className="mono">{event.capacity}</span>
            </span>
          </>
        )}
      </p>
    </div>
  );
}

export default function EventCard({ event, manage = false }) {
  const link = `/events/${event.id}`;
  return (
    <article className={`${styles.card} glass-2`}>
      <Link to={link} className={styles.coverLink} tabIndex={-1} aria-hidden="true">
        <EventCover event={event} />
      </Link>
      <div className={styles.date} aria-hidden="true">
        <span className="mono">{formatDayMonth(event.start_time)}</span>
        <span className="small">{formatWeekday(event.start_time)}</span>
      </div>

      <div className={styles.body}>
        <p className={`${styles.category} small muted`}>{event.category}</p>
        <h3 className={styles.title}>
          <Link to={link}>{event.title}</Link>
        </h3>
        <p className="small muted">
          <span className="mono">{formatTimeRange(event.start_time, event.end_time)}</span>
          <br />
          {event.venue}
        </p>
        {event.organizer_name ? <p className="small muted">By {event.organizer_name}</p> : null}
        {event.status === "cancelled" ? <StatusMarker status="cancelled" /> : null}
        {event.my_status && !manage ? (
          <StatusMarker
            status={event.my_status}
            label={
              event.my_status === "waitlisted" && event.my_waitlist_position
                ? `Waitlisted, position ${event.my_waitlist_position}`
                : undefined
            }
          />
        ) : null}
        {event.clash_with_title && !event.my_status ? (
          <p className={`${styles.clash} small`}>Overlaps with {event.clash_with_title}</p>
        ) : null}
      </div>

      <div className={styles.footer}>
        <Seats event={event} />
        {manage ? (
          <div className={styles.manage}>
            <Button variant="primary" to={`/events/${event.id}/participants`} aria-label={`Participants of ${event.title}`}>
              Participants
            </Button>
            <Button to={`/events/${event.id}/edit`} aria-label={`Edit ${event.title}`}>
              Edit
            </Button>
          </div>
        ) : (
          <Action event={event} />
        )}
      </div>
    </article>
  );
}
