import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import EventRow, { Availability } from "../components/EventRow.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useAuth } from "../lib/auth.jsx";
import { formatDayMonth, formatTime } from "../lib/format.js";
import { events, myEvents, myRegistrations } from "../resources/index.js";
import styles from "./pages.module.css";

function ListSkeleton({ rows = 4 }) {
  return (
    <ul className={styles.list} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={styles.skeletonRow}>
          <Skeleton width="48px" />
          <div className={styles.skeletonText}>
            <Skeleton width="70%" />
            <Skeleton width="45%" height={12} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Failure({ error, onRetry }) {
  return (
    <div className={styles.panelBody} role="alert">
      <p className="muted">{error.message}</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}

function Figure({ value, label, note }) {
  return (
    <div className={styles.figure}>
      <p className={`${styles.figureValue} mono`}>{value}</p>
      <p className="small">{label}</p>
      {note ? <p className="small muted">{note}</p> : null}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const upcoming = events.useList({ upcoming: "true", status: "published", sort: "start_time", limit: 100 });
  const mine = myRegistrations.useList({ upcoming: "true", limit: 6 });
  const organizer = user.role === "faculty" || user.role === "admin";
  const organised = myEvents.useList({ upcoming: "true", sort: "start_time", limit: 5 }, { enabled: organizer });

  const items = upcoming.data?.items || [];
  const seats = items.reduce((sum, e) => sum + e.capacity, 0);
  const filled = items.reduce((sum, e) => sum + e.registered_count, 0);
  const loading = upcoming.isLoading || mine.isLoading;

  return (
    <>
      <p className={`${styles.lead} muted`}>
        Welcome back, {user.name.replace(/^(dr|prof)\.?\s+/i, "").split(" ")[0]}. Here is what is coming up on campus.
        {user.role === "admin" ? (
          <>
            {" "}
            <Link to="/reports">Open the reports</Link>.
          </>
        ) : null}
      </p>

      <section className={`${styles.strip} glass-1`} aria-label="Overview">
        <Figure value={loading ? "..." : upcoming.data?.total ?? "-"} label="Upcoming events" />
        <Figure value={loading ? "..." : mine.data?.total ?? "-"} label="My registrations" note="Confirmed and waitlisted" />
        <Figure
          value={loading || !seats ? "-" : `${Math.round((filled / seats) * 100)}%`}
          label="Seats filled"
          note={seats ? `${filled} of ${seats} seats in upcoming events` : undefined}
        />
      </section>

      <div className={styles.dashGrid}>
        <section className={`${styles.panel} glass-2`} aria-labelledby="upcoming-heading">
          <div className={styles.panelHeader}>
            <h2 id="upcoming-heading">Upcoming events</h2>
            <Link to="/events">See all events</Link>
          </div>
          {upcoming.isLoading ? <ListSkeleton rows={5} /> : null}
          {upcoming.error && !upcoming.data ? <Failure error={upcoming.error} onRetry={upcoming.refetch} /> : null}
          {upcoming.data && items.length === 0 ? (
            <div className={styles.panelBody}>
              <p>No upcoming events yet.</p>
              <p className="muted">Check back soon, or ask a faculty member to create one.</p>
            </div>
          ) : null}
          {items.length ? (
            <ul className={styles.list}>
              {items.slice(0, 6).map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          ) : null}
        </section>

        <section className={`${styles.panel} glass-2`} aria-labelledby="mine-heading">
          <div className={styles.panelHeader}>
            <h2 id="mine-heading">My registrations</h2>
          </div>
          {mine.isLoading ? <ListSkeleton rows={3} /> : null}
          {mine.error && !mine.data ? <Failure error={mine.error} onRetry={mine.refetch} /> : null}
          {mine.data && mine.data.items.length === 0 ? (
            <div className={styles.panelBody}>
              <p>You have no upcoming registrations.</p>
              <p className="muted">Browse events and join one.</p>
              <Button variant="primary" to="/events">
                Explore events
              </Button>
            </div>
          ) : null}
          {mine.data?.items.length ? (
            <ul className={styles.list}>
              {mine.data.items.map((reg) => (
                <li key={reg.registration_id} className={styles.compactRow}>
                  <Link to={`/events/${reg.event.id}`} className={styles.compactTitle}>
                    {reg.event.title}
                  </Link>
                  <p className="small muted">
                    <span className="mono">
                      {formatDayMonth(reg.event.start_time)}, {formatTime(reg.event.start_time)}
                    </span>
                    , {reg.event.venue}
                  </p>
                  <Availability event={reg.event} />
                  {reg.event.clash_with_title ? (
                    <p className="small muted">Overlaps with {reg.event.clash_with_title}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {organizer ? (
        <section className={`${styles.panel} glass-2`} aria-labelledby="organised-heading">
          <div className={styles.panelHeader}>
            <h2 id="organised-heading">My events</h2>
            <span className={styles.rowActions}>
              <Button size="sm" variant="primary" to="/events/new">Create event</Button>
              <Link to="/my-events">See all</Link>
            </span>
          </div>
          {organised.isLoading ? <ListSkeleton rows={2} /> : null}
          {organised.error && !organised.data ? <Failure error={organised.error} onRetry={organised.refetch} /> : null}
          {organised.data && organised.data.items.length === 0 ? (
            <div className={styles.panelBody}>
              <p>You have no upcoming events.</p>
              <p className="muted">Create one and students can register right away.</p>
            </div>
          ) : null}
          {organised.data?.items.length ? (
            <ul className={styles.list}>
              {organised.data.items.map((event) => (
                <EventRow key={event.id} event={event}>
                  <p className="small">
                    <span className="mono">{event.registered_count}</span> of <span className="mono">{event.capacity}</span> seats taken
                    {event.waitlisted_count ? <>, <span className="mono">{event.waitlisted_count}</span> waiting</> : null}
                    {". "}
                    <Link to={`/events/${event.id}/participants`}>Manage participants</Link>
                  </p>
                </EventRow>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
