import styles from "./Skeleton.module.css";

/** Static placeholder bar. Used instead of spinner overlays while data loads. */
export default function Skeleton({ width = "100%", height = 14, className = "" }) {
  return <span className={`${styles.bar} ${className}`} style={{ width, height }} aria-hidden="true" />;
}
