import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import styles from "./Toast.module.css";
import { CloseIcon } from "./icons.jsx";

const ToastContext = createContext({ success() {}, error() {}, info() {} });

/** Toasts live in a polite aria-live region. Errors stay longer than confirmations. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind, message) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === "error" ? 8000 : 5000);
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`${styles.toast} glass-3`} role={t.kind === "error" ? "alert" : "status"}>
            <span className={`${styles.kind} ${t.kind === "error" ? styles.errorKind : ""}`}>
              {t.kind === "error" ? "Problem" : t.kind === "success" ? "Done" : "Note"}
            </span>
            <span className={styles.message}>{t.message}</span>
            <button type="button" className={styles.dismiss} onClick={() => dismiss(t.id)} aria-label="Dismiss message">
              <CloseIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
