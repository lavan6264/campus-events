import styles from "./StatusMarker.module.css";

const LABELS = {
  registered: "Registered",
  waitlisted: "Waitlisted",
  full: "Full",
  cancelled: "Cancelled",
  published: "Open",
  ended: "Ended",
};

/** Always a text label plus a small neutral marker, never colour alone.
 *  "full" and "cancelled" use the clay tone, still with their words. */
export default function StatusMarker({ status, label }) {
  const warn = status === "full" || status === "cancelled";
  return (
    <span className={`${styles.status} ${warn ? styles.warn : ""}`}>
      <span className={`${styles.marker} ${styles[status] || ""}`} aria-hidden="true" />
      {label || LABELS[status] || status}
    </span>
  );
}
