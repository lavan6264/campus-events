import styles from "./Backdrop.module.css";

/** A fixed, flat page background layer. */
export default function Backdrop() {
  return <div className={styles.backdrop} aria-hidden="true" />;
}
