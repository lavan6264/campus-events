import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePageTitle } from "../app/Shell.jsx";
import Button from "../components/Button.jsx";
import { DownloadIcon } from "../components/icons.jsx";
import StatusMarker from "../components/StatusMarker.jsx";
import { useToast } from "../components/Toast.jsx";
import { createResource } from "../lib/crud/createResource.js";
import DataTable from "../lib/crud/DataTable.jsx";
import FilterBar, { toApiParams } from "../lib/crud/FilterBar.jsx";
import { useQueryState } from "../lib/crud/useQueryState.js";
import { formatDateTime } from "../lib/format.js";
import { events } from "../resources/index.js";
import { downloadFile } from "../resources/actions.js";
import ErrorPage from "./ErrorPage.jsx";
import styles from "./event.module.css";
import pageStyles from "./pages.module.css";

const DEFAULTS = { sort: "created_at", limit: "20", status: "registered,waitlisted" };

const FILTERS = [
  { name: "q", label: "Search participants", type: "text", placeholder: "Name, email or department" },
  {
    name: "status", label: "Show", type: "select", placeholder: undefined,
    options: [
      { value: "registered,waitlisted", label: "Registered and waitlisted" },
      { value: "registered", label: "Registered only" },
      { value: "waitlisted", label: "Waitlisted only" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
];

const columns = [
  { key: "name", header: "Name", sortable: true, render: (p) => <strong>{p.name}</strong> },
  { key: "email", header: "Email" },
  { key: "department", header: "Department", render: (p) => p.department || "Not set" },
  {
    key: "status", header: "Status", sortable: true,
    render: (p) => (
      <StatusMarker
        status={p.status}
        label={p.status === "waitlisted" ? `Waitlisted, position ${p.waitlist_position}` : undefined}
      />
    ),
  },
  { key: "created_at", sortKey: "created_at", header: "Joined", sortable: true, mono: true, render: (p) => formatDateTime(p.registered_at) },
];

function Figure({ value, label }) {
  return (
    <div className={pageStyles.figure}>
      <p className={`${pageStyles.figureValue} mono`}>{value}</p>
      <p className="small">{label}</p>
    </div>
  );
}

export default function Participants() {
  const { id } = useParams();
  const toast = useToast();
  const [state, setState, clear] = useQueryState(DEFAULTS);
  const [exporting, setExporting] = useState(false);
  const eventQuery = events.useOne(id);
  const participants = useMemo(
    () => createResource(`participants-${id}`, { path: `/events/${id}/participants`, slash: false }),
    [id],
  );
  const params = toApiParams(state, FILTERS);
  const list = participants.useList(params);
  const event = eventQuery.data;
  usePageTitle(event ? `Participants: ${event.title}` : "Participants");

  if (list.error?.status === 403 || eventQuery.error?.status === 403) return <ErrorPage code={403} />;
  if (list.error?.status === 404 || eventQuery.error?.status === 404 || eventQuery.error?.status === 422) return <ErrorPage code={404} />;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(`/events/${id}/participants.csv`, `event-${id}-participants.csv`, {
        q: state.q, status: state.status, sort: state.sort,
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <p>
        <Link to={`/events/${id}`}>Back to the event</Link>
      </p>

      <section className={`${styles.strip} glass-1`} aria-label="Seats">
        <Figure value={event ? `${event.registered_count} of ${event.capacity}` : "..."} label="Seats confirmed" />
        <Figure value={event ? event.waitlisted_count : "..."} label="On the waitlist" />
        <Figure value={event ? event.seats_left : "..."} label="Seats left" />
      </section>

      <FilterBar
        filters={FILTERS}
        values={state}
        defaults={DEFAULTS}
        onChange={setState}
        onClear={() => clear()}
        label="Filter participants"
      />

      <div>
        <div className={styles.toolbar}>
          <p className="small muted" aria-live="polite">
            {list.data ? (
              <>
                <span className="mono">{list.data.total}</span> {list.data.total === 1 ? "person" : "people"} shown
              </>
            ) : (
              "Loading participants"
            )}
          </p>
          <div className={styles.toolbarActions}>
            <Button onClick={exportCsv} disabled={exporting || !list.data?.total}>
              <DownloadIcon size={16} />
              {exporting ? "Preparing file" : "Export CSV"}
            </Button>
          </div>
        </div>
        <DataTable
          caption="Participants"
          noun="people"
          columns={columns}
          data={list.data}
          isLoading={list.isLoading}
          isFetching={list.isFetching}
          error={list.error}
          onRetry={list.refetch}
          sort={state.sort}
          onSort={(sort) => setState({ sort })}
          onPage={(page) => setState({ page })}
          rowKey="registration_id"
          empty={{
            title: "No participants to show",
            text: state.q || state.status !== DEFAULTS.status ? "Clear the search or change what is shown." : "Nobody has registered yet. Share the event to get people in.",
            action: state.q || state.status !== DEFAULTS.status ? <Button variant="primary" onClick={() => clear()}>Clear filters</Button> : undefined,
          }}
        />
      </div>
    </>
  );
}
