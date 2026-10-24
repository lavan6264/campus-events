import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "../app/Shell.jsx";
import Button from "../components/Button.jsx";
import Dialog from "../components/Dialog.jsx";
import Skeleton from "../components/Skeleton.jsx";
import StatusMarker from "../components/StatusMarker.jsx";
import { useAuth } from "../lib/auth.jsx";
import { formatFullDate, formatTimeRange, hasEnded } from "../lib/format.js";
import { events } from "../resources/index.js";
import { useCancelRegistration, useRegister } from "../resources/actions.js";
import ErrorPage from "./ErrorPage.jsx";
import styles from "./event.module.css";

function Detail({ label, children }) {
  return (
    <div className={styles.detailRow}>
      <dt className="small muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The registration panel: one clear next step for every state an event and a person can be in. */
function RegistrationPanel({ event }) {
  const register = useRegister();
  const cancel = useCancelRegistration();
  const busy = register.isPending || cancel.isPending;
  const ended = hasEnded(event);
  const full = event.seats_left <= 0;
  const clash = event.clash_with_title;

  let body;
  if (event.status === "cancelled") {
    body = <p>Registration closed, event cancelled.</p>;
  } else if (ended) {
    body = <p>Registration closed, event ended.</p>;
  } else if (event.my_status === "registered") {
    body = (
      <>
        <StatusMarker status="registered" />
        <p className="muted">You have a seat. Cancelling gives it to the next person on the waitlist.</p>
        {clash ? <p className={styles.notice}>This overlaps with "{clash}", which you are also registered for.</p> : null}
        <Button variant="danger" onClick={() => cancel.mutate(event.id)} disabled={busy}>
          {cancel.isPending ? "Cancelling" : "Cancel registration"}
        </Button>
      </>
    );
  } else if (event.my_status === "waitlisted") {
    body = (
      <>
        <StatusMarker status="waitlisted" label={`On the waitlist, position ${event.my_waitlist_position}`} />
        <p className="muted">You move up when someone cancels. You will get the seat automatically.</p>
        {clash ? <p className={styles.notice}>This overlaps with "{clash}". If you get a seat, you will hold both.</p> : null}
        <Button onClick={() => cancel.mutate(event.id)} disabled={busy}>
          {cancel.isPending ? "Leaving" : "Leave waitlist"}
        </Button>
      </>
    );
  } else if (full) {
    body = (
      <>
        <StatusMarker status="full" label={event.waitlisted_count ? `Full, ${event.waitlisted_count} waiting` : "Full"} />
        <p className="muted">Join the waitlist and you get a seat if one opens up.</p>
        {clash ? <p className={styles.notice}>This overlaps with "{clash}", which you are registered for. You can still wait for a seat.</p> : null}
        <Button variant="primary" onClick={() => register.mutate(event.id)} disabled={busy}>
          {register.isPending ? "Joining" : "Join waitlist"}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className={`${styles.seats} mono`}>
          {event.seats_left} {event.seats_left === 1 ? "seat" : "seats"} left
        </p>
        {clash ? (
          <p className={styles.notice}>
            This clashes with "{clash}", which you are already registered for. Cancel that one first to register here.
          </p>
        ) : null}
        <Button variant="primary" onClick={() => register.mutate(event.id)} disabled={busy || Boolean(clash)}>
          {register.isPending ? "Registering" : "Register"}
        </Button>
      </>
    );
  }

  return (
    <section className={`${styles.side} glass-2`} aria-labelledby="registration-heading">
      <h2 id="registration-heading">Your registration</h2>
      <div className={styles.sideBody}>{body}</div>
    </section>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = events.useOne(id);
  const remove = events.useRemove();
  const [confirming, setConfirming] = useState(false);
  const event = query.data;
  usePageTitle(event?.title);

  if (query.error?.status === 404 || query.error?.status === 422) return <ErrorPage code={404} />;
  if (query.error?.status === 403) return <ErrorPage code={403} />;
  if (query.error && !event) {
    return (
      <div className={`${styles.panel} glass-2`} role="alert">
        <h2>This event did not load</h2>
        <p className="muted">{query.error.message}</p>
        <Button variant="primary" onClick={() => query.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!event) {
    return (
      <div className={`${styles.layout}`} aria-busy="true">
        <div className={`${styles.panel} glass-2`}>
          <Skeleton width="30%" />
          <Skeleton width="80%" height={18} />
          <Skeleton width="100%" height={60} />
          <Skeleton width="60%" />
        </div>
        <div className={`${styles.side} glass-2`}>
          <Skeleton width="50%" />
          <Skeleton width="70%" height={40} />
        </div>
      </div>
    );
  }

  const canManage = user.role === "admin" || user.id === event.organizer_id;

  return (
    <div className={styles.layout}>
      <div className={styles.column}>
        <article className={`${styles.panel} glass-2`}>
          <div className={styles.meta}>
            <span className="small muted">{event.category}</span>
            {event.status === "cancelled" ? <StatusMarker status="cancelled" /> : hasEnded(event) ? <StatusMarker status="ended" /> : null}
          </div>
          <p className={styles.description}>{event.description || "No description yet."}</p>
          <dl className={styles.details}>
            <Detail label="Date">{formatFullDate(event.start_time)}</Detail>
            <Detail label="Time">
              <span className="mono">{formatTimeRange(event.start_time, event.end_time)}</span>
            </Detail>
            <Detail label="Venue">{event.venue}</Detail>
            <Detail label="Organiser">{event.organizer_name || "Unknown"}</Detail>
            <Detail label="Seats">
              <span className="mono">
                {event.registered_count} of {event.capacity}
              </span>{" "}
              taken
              {event.waitlisted_count ? (
                <>
                  , <span className="mono">{event.waitlisted_count}</span> on the waitlist
                </>
              ) : null}
            </Detail>
          </dl>
        </article>

        {canManage ? (
          <section className={`${styles.panel} glass-2`} aria-labelledby="manage-heading">
            <h2 id="manage-heading">Manage this event</h2>
            <div className={styles.actions}>
              <Button variant="primary" to={`/events/${event.id}/participants`}>
                Manage participants
              </Button>
              <Button to={`/events/${event.id}/edit`}>Edit event</Button>
              <Button to={`/events/new?copy=${event.id}`}>Duplicate event</Button>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete event
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <RegistrationPanel event={event} />

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this event?"
        footer={
          <>
            <Button onClick={() => setConfirming(false)} data-autofocus>
              Keep event
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(event.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    navigate("/events", { replace: true });
                  },
                  onError: () => setConfirming(false),
                })
              }
            >
              {remove.isPending ? "Deleting" : "Delete event"}
            </Button>
          </>
        }
      >
        <p>
          "{event.title}" and its {event.registered_count + event.waitlisted_count} registrations will be removed. This
          cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
