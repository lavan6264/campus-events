import styles from "./Backdrop.module.css";

/** Static backdrop: a base colour with a few soft shapes in the same hue, so the glass has something to blur. */
export default function Backdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <span className={`${styles.shape} ${styles.one}`} />
      <span className={`${styles.shape} ${styles.two}`} />
      <span className={`${styles.shape} ${styles.three}`} />
    </div>
  );
}
