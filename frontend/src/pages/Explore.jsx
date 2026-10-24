import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { Availability } from "../components/EventRow.jsx";
import { api } from "../lib/crud/api.js";
import DataTable from "../lib/crud/DataTable.jsx";
import FilterBar, { toApiParams } from "../lib/crud/FilterBar.jsx";
import { useQueryState } from "../lib/crud/useQueryState.js";
import { formatDayMonth, formatTimeRange, formatWeekday } from "../lib/format.js";
import { events } from "../resources/index.js";
import styles from "./pages.module.css";

const DEFAULTS = { sort: "start_time", limit: "12", upcoming: "true" };

const endOfDay = (date) => `${date}T23:59:59`;

function useFilters(categories) {
  return [
    { name: "q", label: "Search", type: "text", placeholder: "Title, topic or venue" },
    {
      name: "upcoming", label: "When", type: "select",
      options: [{ value: "true", label: "Upcoming" }, { value: "false", label: "Past" }, { value: "all", label: "All" }],
      placeholder: undefined,
      transform: (v) => (v === "all" ? undefined : v),
    },
    {
      name: "category", label: "Category", type: "select",
      options: (categories || []).map((c) => ({ value: c, label: c })), placeholder: "All categories",
    },
    { name: "from", label: "From date", type: "date", param: "start_time__gte" },
    { name: "to", label: "To date", type: "date", param: "start_time__lte", transform: endOfDay },
    { name: "organizer", label: "Organizer", type: "text", placeholder: "Name" },
  ];
}

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
        <span className="small muted">{e.organizer_name ? `By ${e.organizer_name}` : ""}</span>
      </span>
    ),
  },
  { key: "category", header: "Category", sortable: true },
  { key: "venue", header: "Venue" },
  { key: "availability", header: "Availability", render: (e) => <Availability event={e} /> },
];

export default function Explore() {
  const [state, setState, clear] = useQueryState(DEFAULTS);
  const categoriesQuery = useQuery({ queryKey: ["events", "categories"], queryFn: () => api("/events/categories"), staleTime: 5 * 60 * 1000 });
  const filters = useFilters(categoriesQuery.data);
  const params = toApiParams(state, filters);
  const list = events.useList(params);

  const noResultsAction = (
    <Button variant="primary" onClick={() => clear()}>
      Clear filters
    </Button>
  );

  return (
    <>
      <FilterBar
        filters={filters}
        values={state}
        defaults={DEFAULTS}
        onChange={setState}
        onClear={() => clear()}
        label="Filter events"
      />
      <div>
        <p className={`${styles.resultCount} small muted`} aria-live="polite">
          {list.data ? (
            <>
              <span className="mono">{list.data.total}</span> {list.data.total === 1 ? "event" : "events"} found
            </>
          ) : (
            "Loading events"
          )}
        </p>
        <DataTable
          caption="Events"
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
            title: "No events match",
            text: "Clear filters or try a different date.",
            action: noResultsAction,
          }}
        />
      </div>
    </>
  );
}
