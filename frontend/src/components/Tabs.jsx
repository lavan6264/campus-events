import { useId, useRef } from "react";
import styles from "./Tabs.module.css";

/** Accessible tab list: arrow keys move between tabs, Home and End jump to the ends.
 *  `tabs` is [{ id, label }]. Render the matching panel yourself with `panelProps(id)`. */
export default function Tabs({ tabs, value, onChange, label, idPrefix, withPanels = false }) {
  const generated = useId();
  const base = idPrefix || generated;
  const refs = useRef({});

  const onKeyDown = (event) => {
    const index = tabs.findIndex((t) => t.id === value);
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };

  return (
    <div className={styles.list} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => (refs.current[tab.id] = el)}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={withPanels ? `${base}-panel-${tab.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            className={`${styles.tab} ${selected ? styles.selected : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** Props for the panel of a tab. Pass the same idPrefix you gave to Tabs. */
export function tabPanelProps(tabsId, id) {
  return { role: "tabpanel", id: `${tabsId}-panel-${id}`, "aria-labelledby": `${tabsId}-tab-${id}` };
}
