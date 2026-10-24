import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import StatusMarker from "../components/StatusMarker.jsx";
import DataTable from "../lib/crud/DataTable.jsx";
import FilterBar, { toApiParams } from "../lib/crud/FilterBar.jsx";
import { useQueryState } from "../lib/crud/useQueryState.js";
import { formatDayMonth, formatTimeRange, formatWeekday, hasEnded } from "../lib/format.js";
import { myEvents } from "../resources/index.js";
import styles from "./pages.module.css";

const DEFAULTS = { sort: "-start_time", limit: "10" };

const FILTERS = [
  { name: "q", label: "Search my events", type: "text", placeholder: "Title, topic or venue" },
  {
    name: "upcoming", label: "When", type: "select", placeholder: "All dates",
    options: [{ value: "true", label: "Upcoming" }, { value: "false", label: "Past" }],
  },
];

const columns = [
  {
    key: "start_time", header: "Date", sortable: true,
    render: (e) => (
      <span className={styles.dateCell}>
        <span className="mono">{formatDayMonth(e.start_time)}</span>
        <span className="small muted">
          {formatWeekday(e.start_time)}, <span className="mono">{formatTimeRange(e.start_time, e.end_time)}</span>
        </span>
      </span>
    ),
  },
  {
    key: "title", header: "Event", sortable: true,
    render: (e) => (
      <span className={styles.titleCell}>
        <Link to={`/events/${e.id}`}>{e.title}</Link>
        <span className="small muted">{e.venue}</span>
      </span>
    ),
  },
  {
    key: "capacity", header: "Seats", sortable: true,
    render: (e) => (
      <span className={styles.dateCell}>
        <span className="mono">
          {e.registered_count} of {e.capacity}
        </span>
        {e.waitlisted_count ? <span className="small muted">{e.waitlisted_count} waiting</span> : null}
      </span>
    ),
  },
  {
    key: "status", header: "Status",
    render: (e) =>
      e.status === "cancelled" ? <StatusMarker status="cancelled" /> : hasEnded(e) ? <StatusMarker status="ended" /> : <StatusMarker status="published" />,
  },
  {
    key: "actions", header: "Manage",
    render: (e) => (
      <span className={styles.rowActions}>
        <Button size="sm" to={`/events/${e.id}/participants`}>Participants</Button>
        <Button size="sm" to={`/events/${e.id}/edit`}>Edit</Button>
      </span>
    ),
  },
];

export default function MyEvents() {
  const [state, setState, clear] = useQueryState(DEFAULTS);
  const list = myEvents.useList(toApiParams(state, FILTERS));
  const filtered = state.q || state.upcoming;

  return (
    <>
      <div className={styles.pageActions}>
        <p className="muted">Events you organise. Open one to see who is coming.</p>
        <Button variant="primary" to="/events/new">Create event</Button>
      </div>
      <FilterBar filters={FILTERS} values={state} defaults={DEFAULTS} onChange={setState} onClear={() => clear()} label="Filter my events" />
      <DataTable
        caption="My events"
        noun="events"
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={list.refetch}
        sort={state.sort}
        onSort={(sort) => setState({ sort })}
        onPage={(page) => setState({ page })}
        empty={{
          title: filtered ? "No events match" : "You have not created an event yet",
          text: filtered ? "Clear the search or pick another date range." : "Create your first event and students can register right away.",
          action: filtered ? (
            <Button variant="primary" onClick={() => clear()}>Clear filters</Button>
          ) : (
            <Button variant="primary" to="/events/new">Create event</Button>
          ),
        }}
      />
    </>
  );
}
