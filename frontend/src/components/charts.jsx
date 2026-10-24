import { useId, useState } from "react";
import styles from "./charts.module.css";

/**
 * Charts are plain HTML and CSS, so text stays real and readable on a phone.
 * Bars use the accent hue on a tonal track, a 4px rounded tip and a square base.
 * The clay tone appears only for "full". Every chart can also be read as a table.
 */

function niceMax(value) {
  // Small values use an even top so the middle tick is a whole number.
  if (value <= 10) return Math.max(4, Math.ceil(value / 2) * 2);
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = [1, 2, 3, 4, 5, 6, 8, 10].find((x) => n <= x);
  return step * pow;
}

/** A titled panel with a switch between the chart and the same numbers as a table. */
export function ChartFrame({ title, subtitle, table, children, className = "" }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className={`${styles.frame} glass-2 ${className}`} aria-labelledby={id}>
      <div className={styles.frameHeader}>
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle ? <p className="small muted">{subtitle}</p> : null}
        </div>
        <button type="button" className={styles.toggle} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
      {asTable ? (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={j > 0 ? "mono" : ""}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** Vertical bars over time. Only the peak is labelled; the rest is in the tooltip and the table. */
export function ColumnChart({ data, height = 180, unit = "registrations" }) {
  const [active, setActive] = useState(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const peakIndex = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const ticks = [max, max / 2, 0];
  const mid = Math.floor((data.length - 1) / 2);

  return (
    <div className={styles.columns}>
      <div className={styles.plot} style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className={styles.gridline} style={{ bottom: `${(t / max) * 100}%` }}>
            <span className={`${styles.tick} mono`}>{Number.isInteger(t) ? t : t.toFixed(1)}</span>
          </div>
        ))}
        <div className={styles.bars} onMouseLeave={() => setActive(null)}>
          {data.map((d, i) => (
            <div
              key={d.label}
              className={styles.slot}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${d.value} ${unit}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className={`${styles.column} ${active === i ? styles.hot : ""}`} style={{ height: `${(d.value / max) * 100}%` }}>
                {i === peakIndex && d.value > 0 ? <span className={`${styles.peak} mono small`}>{d.value}</span> : null}
              </span>
            </div>
          ))}
        </div>
        {active !== null ? (
          <div
            className={`${styles.tip} glass-3`}
            style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
            role="presentation"
          >
            <span className="small muted">{data[active].label}</span>
            <span className="mono">
              {data[active].value} {unit}
            </span>
          </div>
        ) : null}
      </div>
      <div className={`${styles.xaxis} small muted mono`} aria-hidden="true">
        <span>{data[0].label}</span>
        <span>{data[mid].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

/**
 * Horizontal bars with the value at the tip. `rows`: [{ label, value, display, note, full }].
 * `max` fixes the scale (for example 100 for percentages), otherwise the largest value sets it.
 */
export function BarList({ rows, max, unit = "" }) {
  const scale = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={styles.barList}>
      {rows.map((row) => (
        <li key={row.label} className={styles.barRow} title={`${row.label}: ${row.display ?? row.value}${unit}`}>
          <div className={styles.barLabel}>
            <span>{row.label}</span>
            {row.note ? <span className="small muted">{row.note}</span> : null}
          </div>
          <div className={styles.track}>
            <span
              className={`${styles.fill} ${row.full ? styles.fullFill : ""}`}
              style={{ width: `${Math.min(100, (row.value / scale) * 100)}%` }}
            />
          </div>
          <span className={`${styles.value} mono ${row.full ? styles.fullText : ""}`}>
            {row.display ?? row.value}
            {unit}
            {row.full ? <span className="visually-hidden"> (full)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
