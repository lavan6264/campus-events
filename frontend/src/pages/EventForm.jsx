import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePageTitle } from "../app/Shell.jsx";
import Button from "../components/Button.jsx";
import { Textarea } from "../components/Input.jsx";
import ImagePicker from "../components/ImagePicker.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/crud/api.js";
import { formatDateTime, formatTime } from "../lib/format.js";
import ResourceForm, { localInputToIso } from "../lib/crud/ResourceForm.jsx";
import { events } from "../resources/index.js";
import { aiDraft, useCategories } from "../resources/actions.js";
import ErrorPage from "./ErrorPage.jsx";
import styles from "./event.module.css";

const VENUES = ["Main Auditorium", "Seminar Hall", "Innovation Lab", "Sports Ground", "Open Amphitheatre"];

/** Same rules as the API, so most mistakes show before anything is sent. */
function buildFields(categories, isEdit) {
  const fields = [
    { name: "title", label: "Title", required: true, maxLength: 200, span: 2 },
    {
      name: "category", label: "Category", type: "select", required: true, placeholder: "Choose a category",
      options: (categories || []).map((c) => ({ value: c, label: c })),
    },
    {
      name: "venue", label: "Venue", required: true, maxLength: 120, list: "venues",
      help: "Pick a common venue or type your own.",
    },
    { name: "start_time", label: "Starts", type: "datetime", required: true },
    {
      name: "end_time", label: "Ends", type: "datetime", required: true,
      validate: (value, values) =>
        values.start_time && new Date(value) <= new Date(values.start_time) ? "Must be after the start time" : null,
    },
    {
      name: "capacity", label: "Capacity", type: "number", required: true, min: 1, max: 100000,
      help: isEdit ? "Cannot go below the number of confirmed registrations." : "Seats available. Extra people join a waitlist.",
    },
  ];
  if (isEdit) {
    fields.push({
      name: "status", label: "Status", type: "select", required: true, placeholder: undefined,
      options: [{ value: "published", label: "Published" }, { value: "cancelled", label: "Cancelled" }],
    });
  }
  fields.push({
    name: "image_url", label: "Cover image link", maxLength: 500, span: 2, emptyAs: null,
    help: "Optional. A link starting with https:// to a picture. Leave empty for a drawn cover.",
    validate: (value) => (/^(https?:\/\/|\/(?!\/))\S+$/.test(value) ? null : "Use a link that starts with https://"),
  });
  fields.push({ name: "description", label: "Description", type: "textarea", maxLength: 5000, rows: 6, span: 2, emptyAs: "" });
  return fields;
}

function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Warns before saving when the venue is already taken at that time. The server checks again when the event
 * is saved, so this is advice. An admin can tick a box to book the room anyway.
 */
function VenueCheck({ values, setValues, excludeId, isAdmin }) {
  const venue = (values.venue || "").trim();
  const ready = venue && values.start_time && values.end_time && new Date(values.end_time) > new Date(values.start_time);
  const request = ready
    ? JSON.stringify({ venue, start_time: localInputToIso(values.start_time), end_time: localInputToIso(values.end_time) })
    : null;
  const settled = useDebounced(request, 500);

  const check = useQuery({
    queryKey: ["venue-check", settled, excludeId ?? null],
    queryFn: () => api("/events/venue-check", { params: { ...JSON.parse(settled), exclude_id: excludeId } }),
    enabled: Boolean(settled) && settled === request,
    staleTime: 0,
    gcTime: 0,
  });

  const clash = settled === request ? check.data?.clash : null;
  if (!clash) return null;
  return (
    <div className={styles.venueWarning} role="status">
      <p>
        {venue} is already booked by "{clash.title}"
        {clash.organizer_name ? ` (${clash.organizer_name})` : ""} on {formatDateTime(clash.start_time)} to{" "}
        {formatTime(clash.end_time)}.
      </p>
      {isAdmin ? (
        <label className={styles.override}>
          <input
            type="checkbox"
            checked={Boolean(values.allow_venue_clash)}
            onChange={(e) => setValues({ allow_venue_clash: e.target.checked })}
          />
          Book it anyway (admin only)
        </label>
      ) : (
        <p className="muted">Choose another time or another venue.</p>
      )}
    </div>
  );
}

/** Turns rough notes into a draft. The organizer edits it, and nothing is saved until they press the save button. */
function DraftBox({ values, setValues }) {
  const [notes, setNotes] = useState("");
  const [state, setState] = useState({ status: "idle" });

  const draft = async () => {
    if (!notes.trim()) {
      setState({ status: "error", message: "Write a few lines about the event first." });
      return;
    }
    setState({ status: "loading" });
    try {
      const result = await aiDraft(notes.trim());
      setValues({
        title: result.title || values.title,
        description: result.description,
        category: result.category || values.category,
      });
      setState({ status: "done", source: result.source });
    } catch (error) {
      setState({ status: "error", message: error.message });
    }
  };

  return (
    <div className={styles.draft}>
      <Textarea
        label="Draft with AI"
        help="Write a few rough lines. You edit the draft below before saving."
        rows={3}
        value={notes}
        maxLength={2000}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className={styles.draftRow}>
        <Button onClick={draft} disabled={state.status === "loading"} aria-busy={state.status === "loading"}>
          {state.status === "loading" ? "Drafting" : "Draft with AI"}
        </Button>
        <p className={styles.sourceNote} role="status">
          {state.status === "done" && state.source === "ai"
            ? "Drafted by AI. Check every detail before you save."
            : null}
          {state.status === "done" && state.source === "fallback"
            ? "AI is not available right now, so your notes were copied into the description. Write the title yourself."
            : null}
          {state.status === "error" ? state.message : null}
        </p>
      </div>
    </div>
  );
}

export default function EventForm({ mode }) {
  const isEdit = mode === "edit";
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useCategories();
  const existing = events.useOne(id, { enabled: isEdit });
  const [params] = useSearchParams();
  const copyId = !isEdit ? params.get("copy") : null;
  const source = events.useOne(copyId, { enabled: Boolean(copyId) });
  const create = events.useCreate();
  const update = events.useUpdate();
  usePageTitle(isEdit ? "Edit event" : "Create event");

  if (isEdit) {
    if (existing.error?.status === 404 || existing.error?.status === 422) return <ErrorPage code={404} />;
    if (existing.error?.status === 403) return <ErrorPage code={403} />;
    if (!existing.data) {
      return (
        <div className={`${styles.formPanel} glass-2`} aria-busy="true">
          <Skeleton width="40%" height={18} />
          <Skeleton width="100%" height={40} />
          <Skeleton width="100%" height={120} />
        </div>
      );
    }
    if (user.role !== "admin" && user.id !== existing.data.organizer_id) return <ErrorPage code={403} />;
  }

  if (copyId && source.isLoading) {
    return (
      <div className={`${styles.formPanel} glass-2`} aria-busy="true">
        <Skeleton width="40%" height={18} />
        <Skeleton width="100%" height={40} />
        <Skeleton width="100%" height={120} />
      </div>
    );
  }
  const copying = copyId && source.data ? source.data : null;
  const initialValues = isEdit
    ? existing.data
    : copying
      ? {
          title: `Copy of ${copying.title}`, description: copying.description, category: copying.category,
          venue: copying.venue, capacity: copying.capacity, image_url: copying.image_url || "", status: "published",
        }
      : { status: "published" };

  const fields = buildFields(categories.data, isEdit);

  return (
    <div className={`${styles.formPanel} glass-2`}>
      <datalist id="venues">
        {VENUES.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <ResourceForm
        key={isEdit ? existing.data.id : copying ? `copy-${copying.id}` : "new"}
        fields={fields}
        initialValues={initialValues}
        submitLabel={isEdit ? "Save changes" : "Create event"}
        savingLabel="Saving"
        onCancel={() => navigate(isEdit ? `/events/${id}` : "/events")}
        before={(props) => (
          <>
            {copying ? (
              <p className={styles.sourceNote} role="status">
                Copied from "{copying.title}". Set the date and time for the new event.
              </p>
            ) : null}
            <DraftBox {...props} />
            <ImagePicker
              value={props.values.image_url}
              category={props.values.category}
              onChange={(url) => props.setValues({ image_url: url })}
            />
          </>
        )}
        after={(props) => <VenueCheck {...props} excludeId={isEdit ? Number(id) : undefined} isAdmin={user.role === "admin"} />}
        onSubmit={async (payload, values) => {
          if (user.role === "admin" && values.allow_venue_clash) payload.allow_venue_clash = true;
          if (isEdit) {
            const saved = await update.mutateAsync({ id, ...payload });
            navigate(`/events/${saved.id}`);
          } else {
            const saved = await create.mutateAsync(payload);
            navigate(`/events/${saved.id}`);
          }
        }}
      />
    </div>
  );
}
