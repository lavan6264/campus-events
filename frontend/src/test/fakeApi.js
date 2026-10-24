import { vi } from "vitest";

/**
 * A tiny in memory API for tests. `routes` maps "METHOD /path" to a handler:
 *   (request) => ({ status?, body? })   where request = { params, body, headers, path }
 * Unhandled requests fail the test loudly instead of hanging.
 */
export function installFakeApi(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname.replace(/^\/api/, "");
    const method = (init.method || "GET").toUpperCase();
    const body = init.body instanceof FormData ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : undefined;
    const call = { method, path, params: Object.fromEntries(parsed.searchParams), body, headers: init.headers || {} };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unhandled request in test: ${method} ${path}`);
    const result = await handler(call);
    const status = result?.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(result?.body ?? null), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export const page = (items, extra = {}) => ({
  items,
  page: 1,
  limit: 12,
  total: items.length,
  pages: items.length ? 1 : 0,
  ...extra,
});

export const makeUser = (overrides = {}) => ({
  id: 1,
  name: "Aarav Sharma",
  email: "aarav@campus-demo.test",
  role: "student",
  department: "School of Engineering",
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

let eventCounter = 100;
export const makeEvent = (overrides = {}) => {
  const id = overrides.id ?? ++eventCounter;
  const start = new Date(Date.now() + 3 * 86400000);
  return {
    id,
    title: `Event ${id}`,
    description: "A description",
    category: "Workshop",
    venue: "Innovation Lab",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 2 * 3600000).toISOString(),
    capacity: 20,
    organizer_id: 50,
    organizer_name: "Dr. Meenakshi Iyer",
    status: "published",
    created_at: "2026-10-01T00:00:00Z",
    registered_count: 5,
    waitlisted_count: 0,
    seats_left: 15,
    my_status: null,
    my_waitlist_position: null,
    clash_with_id: null,
    clash_with_title: null,
    ...overrides,
  };
};
