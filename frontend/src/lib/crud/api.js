// One fetch wrapper for the whole app: base URL, bearer token, JSON, normalised errors.
const BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const TOKEN_KEY = "ce.token";
const USER_KEY = "ce.user";

/** The saved session. Browser storage can be missing or blocked, so every access is guarded. */
export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  },
  set(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* the session then lasts only until reload */
    }
  },
  setUser(user) {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Every failure becomes one of these: { message, fields, status }. */
export class ApiError extends Error {
  constructor({ message, fields = null, status = 0 }) {
    super(message);
    this.name = "ApiError";
    this.fields = fields;
    this.status = status;
  }
}

let onUnauthorized = () => {};
/** Called after a 401 on a signed in request, once the session has been cleared. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn || (() => {});
}

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const FALLBACK_MESSAGES = {
  403: "You do not have permission to do that.",
  404: "That could not be found.",
  429: "Too many requests. Wait a moment and try again.",
};

/**
 * api("/events/", { params, method, body, auth, as })
 * `auth: false` skips the bearer token and the sign out on 401 (login and register).
 * `as: "blob"` returns a Blob, for CSV downloads.
 */
export async function api(path, { method = "GET", params, body, auth = true, as = "json", signal } = {}) {
  const headers = { Accept: as === "json" ? "application/json" : "*/*" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = session.token;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}${buildQuery(params)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError({ message: "Cannot reach the server. Check your connection and try again.", status: 0 });
  }

  if (response.ok) {
    if (response.status === 204) return null;
    return as === "blob" ? response.blob() : response.json();
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* not JSON */
  }
  const error = new ApiError({
    message: payload?.error || FALLBACK_MESSAGES[response.status] || "Something went wrong. Try again.",
    fields: payload?.fields || null,
    status: response.status,
  });

  if (response.status === 401 && auth && token) {
    session.clear();
    onUnauthorized(error);
  }
  throw error;
}
