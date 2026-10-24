import { useEffect, useId, useRef, useState } from "react";
import Button from "../../components/Button.jsx";
import { Input, Select, Textarea } from "../../components/Input.jsx";
import styles from "./crud.module.css";

/** "2030-05-01T10:00:00Z" to the "YYYY-MM-DDTHH:mm" text a datetime-local input wants, in local time. */
export function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(text) {
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

/**
 * Client side checks that mirror the server rules, so most mistakes show before a request is sent.
 * Field options: required, minLength, maxLength, min, max, pattern ({ regex, message }), validate(value, values).
 */
export function validateField(field, rawValue, values = {}) {
  const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  const empty = value === "" || value === null || value === undefined;
  if (field.required && empty) return `${field.label} is required`;
  if (empty) return null;

  if (field.type === "number") {
    const n = Number(value);
    if (Number.isNaN(n)) return "Enter a number";
    if (field.integer !== false && !Number.isInteger(n)) return "Enter a whole number";
    if (field.min !== undefined && n < field.min) return `Must be at least ${field.min}`;
    if (field.max !== undefined && n > field.max) return `Must be at most ${field.max}`;
  }
  if (typeof value === "string") {
    if (field.minLength !== undefined && value.length < field.minLength) return `Use at least ${field.minLength} characters`;
    if (field.maxLength !== undefined && value.length > field.maxLength) return `Use at most ${field.maxLength} characters`;
    if (field.pattern && !field.pattern.regex.test(value)) return field.pattern.message;
  }
  if (field.validate) return field.validate(value, values) || null;
  return null;
}

function toPayload(fields, values) {
  const payload = {};
  for (const field of fields) {
    if (field.omit) continue;
    let value = values[field.name];
    if (typeof value === "string") value = value.trim();
    if (value === "" || value === undefined) {
      if ("emptyAs" in field) payload[field.name] = field.emptyAs;
      else if (field.required) payload[field.name] = value;
      continue;
    }
    if (field.type === "number") value = Number(value);
    if (field.type === "datetime") value = localInputToIso(value);
    payload[field.name] = value;
  }
  return payload;
}

/**
 * Config driven form.
 *
 * fields: [{ name, label, type: text|email|password|textarea|number|select|datetime, required, help,
 *            options (select), placeholder, span: 2 (full width), emptyAs, ...validation options }]
 * onSubmit(payload, values) should return a promise. If it rejects with an error that has `fields`
 * (the server's field messages), those appear under the matching inputs.
 * `before({ values, setValues })` renders extra content above the fields, for example an assistant box.
 */
export default function ResourceForm({
  fields,
  initialValues = {},
  onSubmit,
  submitLabel = "Save",
  savingLabel = "Saving",
  onCancel,
  before,
  extraActions,
}) {
  const formId = useId();
  const [values, setValues] = useState(() => {
    const start = {};
    for (const f of fields) {
      const given = initialValues[f.name];
      start[f.name] = f.type === "datetime" ? isoToLocalInput(given) : given ?? "";
    }
    return start;
  });
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const focusAfterSave = useRef(null);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  // Inputs are disabled while saving, so focus the first server error once saving has ended.
  useEffect(() => {
    if (!saving && focusAfterSave.current) {
      document.getElementById(`${formId}-${focusAfterSave.current}`)?.focus();
      focusAfterSave.current = null;
    }
  }, [saving, formId]);

  const clientErrors = {};
  for (const f of fields) clientErrors[f.name] = validateField(f, values[f.name], values);

  const idFor = (name) => `${formId}-${name}`;
  const focusField = (name) => document.getElementById(idFor(name))?.focus();

  const change = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (serverErrors[name]) setServerErrors((e) => ({ ...e, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    const firstBad = fields.find((f) => clientErrors[f.name]);
    if (firstBad) {
      setTouched(Object.fromEntries(fields.map((f) => [f.name, true])));
      focusField(firstBad.name);
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      await onSubmit(toPayload(fields, values), values);
    } catch (error) {
      const fieldErrors = error?.fields || {};
      const known = Object.keys(fieldErrors).filter((name) => fields.some((f) => f.name === name));
      setServerErrors(fieldErrors);
      const unplaced = Object.entries(fieldErrors).filter(([name]) => !known.includes(name));
      if (known.length) focusAfterSave.current = known[0];
      if (!known.length || unplaced.length) {
        setFormError(error?.message || "Something went wrong. Try again.");
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const setAll = (patch) => setValues((v) => ({ ...v, ...patch }));

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {before ? before({ values, setValues: setAll }) : null}
      {formError ? (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      ) : null}
      <div className={styles.formGrid}>
        {fields.map((f) => {
          const error = serverErrors[f.name] || (touched[f.name] ? clientErrors[f.name] : null);
          const common = {
            id: idFor(f.name),
            label: f.label,
            help: f.help,
            error,
            required: f.required,
            value: values[f.name],
            className: f.span === 2 ? styles.span2 : "",
            onChange: (e) => change(f.name, e.target.value),
            onBlur: () => setTouched((t) => ({ ...t, [f.name]: true })),
            disabled: saving,
          };
          if (f.type === "textarea") return <Textarea key={f.name} rows={f.rows || 4} maxLength={f.maxLength} {...common} />;
          if (f.type === "select") {
            return <Select key={f.name} options={f.options} placeholder={f.placeholder ?? "Choose one"} {...common} />;
          }
          const htmlType = { datetime: "datetime-local", number: "number" }[f.type] || f.type || "text";
          return (
            <Input
              key={f.name}
              type={htmlType}
              placeholder={f.placeholder}
              min={f.min}
              max={f.max}
              autoComplete={f.autoComplete}
              list={f.list}
              inputMode={f.type === "number" ? "numeric" : undefined}
              {...common}
            />
          );
        })}
      </div>
      <div className={styles.formActions}>
        {extraActions}
        {onCancel ? (
          <Button onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>
          {saving ? savingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
