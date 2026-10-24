import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { session } from "../lib/crud/api.js";
import { installFakeApi, makeEvent, makeUser } from "./fakeApi.js";
import { renderApp } from "./renderApp.jsx";

const signIn = (role) => session.set("tok", makeUser({ id: role === "admin" ? 1 : 50, name: "Dr. Meenakshi Iyer", role }));

const CLASH = {
  clash: {
    id: 3, title: "Robotics workshop", organizer_name: "Prof. Arvind Kulkarni",
    start_time: "2030-05-01T10:00:00Z", end_time: "2030-05-01T12:00:00Z",
  },
};

const routes = (extra = {}) => ({
  "GET /events/categories": () => ({ body: ["Workshop"] }),
  "GET /events/venue-check": () => ({ body: { clash: null } }),
  ...extra,
});

async function fillForm(ui, { venue = "Innovation Lab", start = "2030-05-01T11:00", end = "2030-05-01T13:00" } = {}) {
  await ui.type(await screen.findByLabelText(/^Title/), "Hack night");
  await ui.selectOptions(screen.getByLabelText(/^Category/), "Workshop");
  await ui.type(screen.getByLabelText(/^Venue/), venue);
  await ui.type(screen.getByLabelText(/^Starts/), start);
  await ui.type(screen.getByLabelText(/^Ends/), end);
  await ui.type(screen.getByLabelText(/^Capacity/), "20");
}

describe("venue already booked", () => {
  it("warns an organiser as soon as the room and times are filled in, and offers no override", async () => {
    signIn("faculty");
    const { calls } = installFakeApi(routes({ "GET /events/venue-check": () => ({ body: CLASH }) }));
    const ui = userEvent.setup();
    renderApp("/events/new");
    await fillForm(ui);

    const warning = await screen.findByText(/is already booked by "Robotics workshop"/, undefined, { timeout: 3000 });
    expect(warning).toHaveTextContent("Innovation Lab is already booked by \"Robotics workshop\" (Prof. Arvind Kulkarni)");
    expect(screen.getByText("Choose another time or another venue.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Book it anyway/)).not.toBeInTheDocument();

    const check = [...calls].reverse().find((c) => c.path === "/events/venue-check");
    expect(check.params.venue).toBe("Innovation Lab");
    expect(check.params.start_time).toMatch(/^2030-05-01T/);
    expect(check.params.exclude_id).toBeUndefined();
  });

  it("does not ask the server until there is a venue and a valid time range", async () => {
    signIn("faculty");
    const { calls } = installFakeApi(routes());
    const ui = userEvent.setup();
    renderApp("/events/new");
    await ui.type(await screen.findByLabelText(/^Venue/), "Innovation Lab");
    await ui.type(screen.getByLabelText(/^Starts/), "2030-05-01T11:00");
    await ui.type(screen.getByLabelText(/^Ends/), "2030-05-01T10:00"); // ends before it starts
    await new Promise((r) => setTimeout(r, 800));
    expect(calls.some((c) => c.path === "/events/venue-check")).toBe(false);
  });

  it("shows nothing when the room is free", async () => {
    signIn("faculty");
    const { calls } = installFakeApi(routes());
    const ui = userEvent.setup();
    renderApp("/events/new");
    await fillForm(ui);
    await waitFor(() => expect(calls.some((c) => c.path === "/events/venue-check")).toBe(true), { timeout: 3000 });
    expect(screen.queryByText(/is already booked/)).not.toBeInTheDocument();
  });

  it("puts the server refusal under the Venue field if the room was taken in the meantime", async () => {
    signIn("faculty");
    installFakeApi(routes({
      "POST /events/": () => ({
        status: 409,
        body: {
          error: 'Innovation Lab is already booked at that time by "Robotics workshop"',
          fields: { venue: 'Already booked at that time by "Robotics workshop"' },
        },
      }),
    }));
    const ui = userEvent.setup();
    renderApp("/events/new");
    await fillForm(ui);
    await ui.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByText('Already booked at that time by "Robotics workshop"')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Venue/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Create event" })).toBeEnabled();
  });

  it("lets an admin book it anyway, and sends that choice with the event", async () => {
    signIn("admin");
    const { calls } = installFakeApi(routes({
      "GET /events/venue-check": () => ({ body: CLASH }),
      "POST /events/": () => ({ status: 201, body: makeEvent({ id: 77 }) }),
      "GET /events/77": () => ({ body: makeEvent({ id: 77 }) }),
    }));
    const ui = userEvent.setup();
    renderApp("/events/new");
    await fillForm(ui);

    const box = await screen.findByLabelText(/Book it anyway/, undefined, { timeout: 3000 });
    expect(box).not.toBeChecked();
    await ui.click(box);
    await ui.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/events/")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/events/").body.allow_venue_clash).toBe(true);
  });

  it("does not send the override unless the admin ticked it", async () => {
    signIn("admin");
    const { calls } = installFakeApi(routes({
      "POST /events/": () => ({ status: 201, body: makeEvent({ id: 78 }) }),
      "GET /events/78": () => ({ body: makeEvent({ id: 78 }) }),
    }));
    const ui = userEvent.setup();
    renderApp("/events/new");
    await fillForm(ui);
    await ui.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/events/")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/events/").body).not.toHaveProperty("allow_venue_clash");
  });

  it("leaves the event itself out of the check when editing", async () => {
    signIn("faculty");
    const event = makeEvent({ id: 12, organizer_id: 50, venue: "Innovation Lab" });
    const { calls } = installFakeApi(routes({ "GET /events/12": () => ({ body: event }) }));
    renderApp("/events/12/edit");
    await waitFor(() => expect(calls.some((c) => c.path === "/events/venue-check")).toBe(true), { timeout: 3000 });
    expect([...calls].reverse().find((c) => c.path === "/events/venue-check").params.exclude_id).toBe("12");
  });
});
