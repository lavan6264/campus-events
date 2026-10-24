import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import EventCard from "../components/EventCard.jsx";
import { Availability } from "../components/EventRow.jsx";
import { Input } from "../components/Input.jsx";
import Tabs from "../components/Tabs.jsx";
import { useAuth } from "../lib/auth.jsx";
import CardGrid from "../lib/crud/CardGrid.jsx";
import DataTable from "../lib/crud/DataTable.jsx";
import FilterBar, { toApiParams } from "../lib/crud/FilterBar.jsx";
import { useQueryState } from "../lib/crud/useQueryState.js";
import { formatDayMonth, formatTimeRange, formatWeekday } from "../lib/format.js";
import { aiSearch, useCategories } from "../resources/actions.js";
import { events } from "../resources/index.js";
import styles from "./pages.module.css";

const DEFAULTS = { sort: "start_time", limit: "12", upcoming: "true", view: "cards" };

const SORT_OPTIONS = [
  { value: "start_time", label: "Date, soonest first" },
  { value: "-start_time", label: "Date, latest first" },
  { value: "title", label: "Title, A to Z" },
  { value: "-title", label: "Title, Z to A" },
  { value: "category", label: "Category" },
];

const VIEWS = [
  { id: "cards", label: "Cards" },
  { id: "table", label: "Table" },
];


const endOfDay = (date) => `${date}T23:59:59`;

function buildFilters(categories) {
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
    { name: "organizer", label: "Organiser", type: "text", placeholder: "Name" },
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

const MODES = [
  { id: "normal", label: "Search" },
  { id: "ai", label: "Describe what you want" },
];

/** Applies what the AI understood to the same URL filters the table already uses. */
function filtersToState(filters) {
  const hasDates = Boolean(filters.start_time__gte || filters.start_time__lte);
  return {
    q: filters.q || "",
    category: filters.category || "",
    from: filters.start_time__gte ? filters.start_time__gte.slice(0, 10) : "",
    to: filters.start_time__lte ? filters.start_time__lte.slice(0, 10) : "",
    organizer: "",
    upcoming: hasDates ? "all" : "true",
  };
}

function AiSearch({ onApply }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState({ phase: "idle" });

  const run = async (event) => {
    event.preventDefault();
    if (!text.trim()) {
      setStatus({ phase: "error", message: "Describe the events you are looking for first." });
      return;
    }
    setStatus({ phase: "loading" });
    try {
      const result = await aiSearch(text.trim());
      onApply(filtersToState(result.filters));
      setStatus({ phase: "done", source: result.source, summary: result.summary });
    } catch (error) {
      setStatus({ phase: "error", message: error.message });
    }
  };

  return (
    <form className={`${styles.aiPanel} glass-1`} onSubmit={run}>
      <div className={styles.aiRow}>
        <Input
          label="Describe what you want"
          help='For example "robotics workshops next week" or "coding events on weekends".'
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={status.phase === "loading"} aria-busy={status.phase === "loading"}>
          {status.phase === "loading" ? "Searching" : "Find events"}
        </Button>
      </div>
      <p className={styles.aiNote} role="status">
        {status.phase === "done" && status.source === "ai" ? `Filters from AI. ${status.summary}. Adjust them below if needed.` : null}
        {status.phase === "done" && status.source === "fallback"
          ? `AI is not available right now, so this is a keyword search. ${status.summary}.`
          : null}
        {status.phase === "error" ? status.message : null}
      </p>
    </form>
  );
}

export default function Explore() {
  const { user } = useAuth();
  const [state, setState, clear] = useQueryState(DEFAULTS);
  const [mode, setMode] = useState("normal");
  const categories = useCategories();
  const filters = buildFilters(categories.data);
  const list = events.useList(toApiParams(state, filters));
  const canCreate = user.role === "faculty" || user.role === "admin";

  const empty = {
    title: "No events match",
    text: "Clear filters or try a different date.",
    action: (
      <Button variant="primary" onClick={() => clear(["view"])}>
        Clear filters
      </Button>
    ),
  };

  return (
    <>
      <div className={styles.searchHead}>
        <div className={styles.searchToggle}>
          <Tabs tabs={MODES} value={mode} onChange={setMode} label="Search mode" idPrefix="explore-mode" />
        </div>
        <div className={styles.viewTools}>
          <div className={styles.viewToggle}>
            <Tabs tabs={VIEWS} value={state.view} onChange={(view) => setState({ view })} label="View" idPrefix="explore-view" />
          </div>
          {canCreate ? (
            <Button variant="primary" to="/events/new">
              Create event
            </Button>
          ) : null}
        </div>
      </div>

      {mode === "ai" ? <AiSearch onApply={(patch) => setState(patch)} /> : null}

      <FilterBar
        filters={filters}
        values={state}
        defaults={DEFAULTS}
        onChange={setState}
        onClear={() => clear(["view"])}
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
        {state.view === "table" ? (
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
            empty={empty}
          />
        ) : (
          <CardGrid
            noun="events"
            data={list.data}
            isLoading={list.isLoading}
            isFetching={list.isFetching}
            error={list.error}
            onRetry={list.refetch}
            sort={state.sort}
            onSort={(sort) => setState({ sort })}
            sortOptions={SORT_OPTIONS}
            onPage={(page) => setState({ page })}
            renderCard={(event) => <EventCard event={event} />}
            empty={empty}
          />
        )}
      </div>
    </>
  );
}
