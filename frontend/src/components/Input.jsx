import { forwardRef, useId } from "react";
import styles from "./Input.module.css";
import { ChevronDownIcon } from "./icons.jsx";

/** Visible label above, optional help text, and an inline error tied to the control with aria-describedby. */
export function Field({ id, label, help, error, required, children, className = "", hideLabel = false }) {
  return (
    <div className={`${styles.field} ${className}`}>
      <label htmlFor={id} className={`${styles.label} ${hideLabel ? "visually-hidden" : ""}`}>
        {label}
        {required ? <span className={styles.required}> (required)</span> : null}
      </label>
      {children}
      {help && !error ? (
        <p id={`${id}-help`} className={styles.help}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id, help, error) {
  if (error) return `${id}-error`;
  if (help) return `${id}-help`;
  return undefined;
}

export const Input = forwardRef(function Input({ label, help, error, required, className, id, hideLabel, ...props }, ref) {
  const auto = useId();
  const fieldId = id || auto;
  return (
    <Field id={fieldId} label={label} help={help} error={error} required={required} className={className} hideLabel={hideLabel}>
      <input
        ref={ref}
        id={fieldId}
        className={styles.control}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, help, error)}
        {...props}
      />
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea({ label, help, error, required, className, id, rows = 4, ...props }, ref) {
  const auto = useId();
  const fieldId = id || auto;
  return (
    <Field id={fieldId} label={label} help={help} error={error} required={required} className={className}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        className={`${styles.control} ${styles.textarea}`}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, help, error)}
        {...props}
      />
    </Field>
  );
});

export const Select = forwardRef(function Select(
  { label, help, error, required, className, id, hideLabel, options = [], placeholder, children, ...props },
  ref,
) {
  const auto = useId();
  const fieldId = id || auto;
  return (
    <Field id={fieldId} label={label} help={help} error={error} required={required} className={className} hideLabel={hideLabel}>
      <div className={styles.selectWrap}>
        <select
          ref={ref}
          id={fieldId}
          className={`${styles.control} ${styles.select}`}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, help, error)}
          {...props}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDownIcon className={styles.chevron} size={16} />
      </div>
    </Field>
  );
});
