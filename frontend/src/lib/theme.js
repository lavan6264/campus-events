import { useState } from "react";

const KEY = "ce.theme";

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function savedTheme() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The theme is a data attribute on <html>. index.html sets it before the first paint. */
export function currentTheme() {
  return document.documentElement.dataset.theme || savedTheme() || systemTheme();
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the choice then lasts until reload */
    }
    setTheme(next);
  };

  return { theme, toggle };
}
