import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { BarList, ChartFrame, ColumnChart } from "../components/charts.jsx";
import { Select } from "../components/Input.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/crud/api.js";
import DataTable from "../lib/crud/DataTable.jsx";
import FilterBar, { toApiParams } from "../lib/crud/FilterBar.jsx";
import { useQueryState } from "../lib/crud/useQueryState.js";
import { formatDayMonth, formatDateTime, roleWithArticle } from "../lib/format.js";
import { users } from "../resources/index.js";
import styles from "./pages.module.css";
import reportStyles from "./reports.module.css";

const ROLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "faculty", label: "Organiser" },
  { value: "admin", label: "Admin" },
];

const USER_DEFAULTS = { sort: "name", limit: "8" };
const USER_FILTERS = [
  { name: "q", label: "Search users", type: "text", placeholder: "Name, email or department" },
  { name: "role", label: "Role", type: "select", options: ROLE_OPTIONS, placeholder: "All roles" },
];

function Figure({ value, label, note }) {
  return (
    <div className={styles.figure}>
      <p className={`${styles.figureValue} mono`}>{value}</p>
      <p className="small">{label}</p>
      {note ? <p className="small muted">{note}</p> : null}
    </div>
  );
}

function SummaryPanel() {
  const query = useQuery({
    queryKey: ["admin", "ai-summary"],
    queryFn: () => api("/admin/ai/summary"),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <section className={`${styles.panel} glass-2`} aria-labelledby="summary-heading">
      <div className={styles.panelHeader}>
        <h2 id="summary-heading">Summary</h2>
        <Button size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? "Writing" : "Refresh summary"}
        </Button>
      </div>
      <div className={reportStyles.summary} aria-busy={query.isLoading}>
        {query.isLoading ? (
          <>
            <Skeleton width="95%" />
            <Skeleton width="88%" />
            <Skeleton width="70%" />
          </>
        ) : null}
        {query.error && !query.data ? <p className="muted">The summary could not be written. {query.error.message}</p> : null}
        {query.data ? (
          <>
            <p className={reportStyles.summaryText}>{query.data.summary}</p>
            <p className="small muted">
              {query.data.source === "ai"
                ? "Written by AI from the numbers on this page."
                : "Built from the numbers on this page. AI was not available."}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

function UserTable() {
  const { user: me } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [state, setState, clear] = useQueryState(USER_DEFAULTS);
  const list = users.useList(toApiParams(state, USER_FILTERS));

  const changeRole = useMutation({
    mutationFn: ({ id, role }) => api(`/admin/users/${id}/role`, { method: "PATCH", body: { role } }),
    onSuccess: (updated) => {
      client.invalidateQueries({ queryKey: users.keys.all });
      toast.success(`${updated.name} is now ${roleWithArticle(updated.role)}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const columns = [
    { key: "name", header: "Name", sortable: true, render: (u) => <strong>{u.name}</strong> },
    { key: "email", header: "Email", sortable: true },
    { key: "department", header: "Department", render: (u) => u.department || "Not set" },
    {
      key: "role", header: "Role", sortable: true,
      render: (u) => (
        <Select
          hideLabel
          label={`Role for ${u.name}`}
          value={u.role}
          options={ROLE_OPTIONS}
          disabled={changeRole.isPending || u.id === me.id}
          title={u.id === me.id ? "You cannot change your own role" : undefined}
          onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value })}
        />
      ),
    },
    { key: "created_at", header: "Joined", sortable: true, mono: true, render: (u) => formatDayMonth(u.created_at) },
  ];

  return (
    <section className={reportStyles.users} aria-labelledby="users-heading">
      <h2 id="users-heading">Users</h2>
      <FilterBar filters={USER_FILTERS} values={state} defaults={USER_DEFAULTS} onChange={setState} onClear={() => clear()} label="Filter users" />
      <DataTable
        caption="Users"
        noun="users"
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={list.refetch}
        sort={state.sort}
        onSort={(sort) => setState({ sort })}
        onPage={(page) => setState({ page })}
        empty={{ title: "No users match", text: "Clear the search or pick another role.", action: <Button variant="primary" onClick={() => clear()}>Clear filters</Button> }}
      />
    </section>
  );
}

export default function Reports() {
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api("/admin/stats"), staleTime: 30_000 });
  const s = stats.data;

  if (stats.error && !s) {
    return (
      <div className={`${styles.panel} glass-2`} role="alert">
        <div className={styles.panelBody}>
          <h2>The reports did not load</h2>
          <p className="muted">{stats.error.message}</p>
          <Button variant="primary" onClick={() => stats.refetch()}>Try again</Button>
        </div>
      </div>
    );
  }

  const t = s?.totals;
  const days = s?.registrations_per_day.map((d) => ({ label: formatDayMonth(d.date), value: d.registrations })) || [];
  const total30 = days.reduce((sum, d) => sum + d.value, 0);

  return (
    <>
      <section className={`${styles.strip} glass-1`} aria-label="Totals">
        <Figure value={t ? t.confirmed_registrations : "..."} label="Confirmed registrations" note={t ? `${t.waitlisted_registrations} on waitlists` : undefined} />
        <Figure value={t ? `${t.fill_rate}%` : "..."} label="Seat fill rate" note={t ? `of ${t.capacity} seats` : undefined} />
        <Figure value={t ? t.upcoming_events : "..."} label="Upcoming events" note={t ? `${t.published_events} published in total` : undefined} />
        <Figure value={t ? t.users : "..."} label="Users" />
      </section>

      <SummaryPanel />

      {!s ? (
        <div className={`${styles.panel} glass-2`} aria-busy="true">
          <div className={styles.panelBody}>
            <Skeleton width="40%" />
            <Skeleton width="100%" height={140} />
          </div>
        </div>
      ) : (
        <>
          <div className={reportStyles.grid}>
            <ChartFrame
              title="Registrations per day"
              subtitle={`Last 30 days, ${total30} in total`}
              table={{ columns: ["Day", "Registrations"], rows: days.map((d) => [d.label, d.value]) }}
            >
              <ColumnChart data={days} />
            </ChartFrame>

            <ChartFrame
              title="Registrations per category"
              subtitle="Confirmed seats in published events"
              table={{
                columns: ["Category", "Events", "Registered", "Capacity", "Fill rate"],
                rows: s.registrations_per_category.map((c) => [c.category, c.events, c.registrations, c.capacity, `${c.fill_rate}%`]),
              }}
            >
              <BarList
                rows={s.registrations_per_category.map((c) => ({
                  label: c.category,
                  value: c.registrations,
                  note: c.events ? `${c.events} ${c.events === 1 ? "event" : "events"}, ${c.fill_rate}% full` : "No events",
                }))}
              />
            </ChartFrame>
          </div>

          <ChartFrame
            title="Top events"
            subtitle="By confirmed registrations, with how full each one is"
            table={{
              columns: ["Event", "Category", "Registered", "Capacity", "Waitlisted", "Fill rate"],
              rows: s.top_events.map((e) => [e.title, e.category, e.registered, e.capacity, e.waitlisted, `${e.fill_rate}%`]),
            }}
          >
            {s.top_events.length ? (
              <BarList
                max={100}
                unit="%"
                rows={s.top_events.map((e) => ({
                  label: e.title,
                  value: e.fill_rate,
                  display: e.fill_rate,
                  full: e.registered >= e.capacity,
                  note: `${e.registered} of ${e.capacity} seats${e.waitlisted ? `, ${e.waitlisted} waiting` : ""}, ${formatDateTime(e.start_time)}`,
                }))}
              />
            ) : (
              <p className="muted">No events yet. Create one to see it here.</p>
            )}
          </ChartFrame>

          <p className="small muted">
            Registrations by role: {s.registrations_by_role.map((r) => `${r.role} ${r.registrations}`).join(", ")}.{" "}
            <Link to="/events">See all events</Link>
          </p>
        </>
      )}

      <UserTable />
    </>
  );
}
