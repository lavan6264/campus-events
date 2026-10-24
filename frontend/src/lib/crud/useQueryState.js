import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Keeps page, sort, search and filters in the URL, so a filtered view can be shared and the back button works.
 *
 *   const [state, setState, clear] = useQueryState({ sort: "start_time", limit: "12" });
 *   setState({ category: "Workshop" })   // resets to page 1
 *   setState({ page: 3 })                // keeps everything else
 *
 * Values equal to their default (or empty) are left out of the URL.
 */
export function useQueryState(defaults = {}) {
  const [params, setParams] = useSearchParams();

  const state = useMemo(() => {
    const merged = { ...defaults };
    for (const [key, value] of params.entries()) merged[key] = value;
    merged.page = Math.max(1, parseInt(merged.page, 10) || 1);
    return merged;
    // defaults is a literal at the call site, so key it by content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, JSON.stringify(defaults)]);

  const setState = useCallback(
    (patch) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            const isDefault = defaults[key] !== undefined && String(defaults[key]) === String(value);
            if (value === undefined || value === null || value === "" || isDefault || (key === "page" && Number(value) <= 1)) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          if (!("page" in patch)) next.delete("page");
          return next;
        },
        { replace: false },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams, JSON.stringify(defaults)],
  );

  const clear = useCallback(
    (keep = []) => {
      setParams((current) => {
        const next = new URLSearchParams();
        for (const key of keep) if (current.has(key)) next.set(key, current.get(key));
        return next;
      });
    },
    [setParams],
  );

  return [state, setState, clear];
}
