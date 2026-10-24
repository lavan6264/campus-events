import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, buildQuery, session, setUnauthorizedHandler } from "../lib/crud/api.js";
import { installFakeApi } from "./fakeApi.js";

beforeEach(() => setUnauthorizedHandler(null));

describe("api wrapper", () => {
  it("builds query strings without empty values", () => {
    expect(buildQuery({ page: 2, q: "", sort: undefined, category: "Club Meet", x: null })).toBe("?page=2&category=Club+Meet");
    expect(buildQuery({})).toBe("");
  });

  it("adds the base url and the bearer token", async () => {
    session.set("abc", { id: 1 });
    const { calls } = installFakeApi({ "GET /events/": () => ({ body: { ok: true } }) });
    await expect(api("/events/", { params: { page: 1 } })).resolves.toEqual({ ok: true });
    expect(calls[0].headers.Authorization).toBe("Bearer abc");
    expect(calls[0].params).toEqual({ page: "1" });
  });

  it("normalises server errors to { message, fields, status }", async () => {
    installFakeApi({
      "POST /events/": () => ({ status: 422, body: { error: "Please fix the highlighted fields", fields: { title: "Title is required" } } }),
    });
    const error = await api("/events/", { method: "POST", body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect({ message: error.message, fields: error.fields, status: error.status }).toEqual({
      message: "Please fix the highlighted fields", fields: { title: "Title is required" }, status: 422,
    });
  });

  it("falls back to a plain message when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    const error = await api("/events/").catch((e) => e);
    expect(error.message).toBe("Something went wrong. Try again.");
    expect(error.status).toBe(502);
    expect(error.fields).toBeNull();
  });

  it("reports an unreachable server clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const error = await api("/events/").catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.message).toBe("Cannot reach the server. Check your connection and try again.");
  });

  it("clears the session and calls the handler on a 401 for a signed in request", async () => {
    session.set("abc", { id: 1 });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    installFakeApi({ "GET /me/registrations": () => ({ status: 401, body: { error: "Your session has expired. Please sign in again" } }) });
    await expect(api("/me/registrations")).rejects.toMatchObject({ status: 401 });
    expect(session.token).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not sign out when the login request itself returns 401", async () => {
    session.set("abc", { id: 1 });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    installFakeApi({ "POST /auth/login": () => ({ status: 401, body: { error: "Incorrect email or password" } }) });
    await expect(api("/auth/login", { method: "POST", body: {}, auth: false })).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    expect(session.token).toBe("abc");
  });

  it("returns null for 204 and a blob for downloads", async () => {
    installFakeApi({
      "DELETE /events/1": () => ({ status: 204 }),
    });
    await expect(api("/events/1", { method: "DELETE" })).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a,b\n1,2", { status: 200, headers: { "Content-Type": "text/csv" } })));
    const blob = await api("/events/1/participants.csv", { as: "blob" });
    expect(await blob.text()).toBe("a,b\n1,2");
  });

  it("survives blocked browser storage", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    expect(session.token).toBeNull();
    expect(session.user).toBeNull();
    Storage.prototype.getItem = original;
  });
});
