import { useEffect, useRef, useState } from "react";
import Button from "../../components/Button.jsx";
import { Input, Select } from "../../components/Input.jsx";
import styles from "./crud.module.css";

/**
 * Turns the URL state into API params using the same filter config the FilterBar renders.
 * A filter may define `transform(value)` for values that need converting, such as a date to an end of day.
 */
export function toApiParams(state, filters, extra = {}) {
  const params = { page: state.page, limit: state.limit, sort: state.sort, q: state.q, ...extra };
  for (const f of filters) {
    const value = state[f.name];
    if (value === undefined || value === "") continue;
    params[f.param || f.name] = f.transform ? f.transform(value) : value;
  }
  return params;
}

function TextFilter({ filter, value, onChange }) {
  const [text, setText] = useState(value || "");
  const last = useRef(value || "");

  useEffect(() => {
    // The URL changed from outside (clear, back button): follow it.
    if ((value || "") !== last.current) {
      last.current = value || "";
      setText(value || "");
    }
  }, [value]);

  useEffect(() => {
    if (text === last.current) return undefined;
    const timer = setTimeout(() => {
      last.current = text;
      onChange({ [filter.name]: text.trim() });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, filter.name, onChange]);

  return (
    <Input
      className={styles.filterField}
      label={filter.label}
      value={text}
      placeholder={filter.placeholder}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

/**
 * filters: [{ name, label, type: select|text|date, options?, placeholder? }]
 * values: the URL state. defaults: the values a clean view starts with. onChange(patch) updates the URL.
 * onClear() resets every filter.
 */
export default function FilterBar({ filters, values, defaults = {}, onChange, onClear, label = "Filters" }) {
  // A filter counts as active when it differs from its default, so a default view shows no Clear button.
  const active = filters.some((f) => (values[f.name] || "") !== (defaults[f.name] || ""));
  return (
    <form className={`${styles.filters} glass-1`} role="search" aria-label={label} onSubmit={(e) => e.preventDefault()}>
      {filters.map((f) => {
        if (f.type === "select") {
          return (
            <Select
              key={f.name}
              className={styles.filterField}
              label={f.label}
              value={values[f.name] || ""}
              placeholder={f.placeholder ?? "All"}
              options={f.options}
              onChange={(e) => onChange({ [f.name]: e.target.value })}
            />
          );
        }
        if (f.type === "date") {
          return (
            <Input
              key={f.name}
              className={styles.filterField}
              type="date"
              label={f.label}
              value={values[f.name] || ""}
              onChange={(e) => onChange({ [f.name]: e.target.value })}
            />
          );
        }
        return <TextFilter key={f.name} filter={f} value={values[f.name]} onChange={onChange} />;
      })}
      {active ? (
        <div className={styles.filterActions}>
          <Button onClick={onClear}>Clear filters</Button>
        </div>
      ) : null}
    </form>
  );
}
