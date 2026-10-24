import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { session } from "../lib/crud/api.js";
import { installFakeApi, makeEvent, makeUser, page } from "./fakeApi.js";
import { renderApp } from "./renderApp.jsx";

const signInOrganiser = () => session.set("tok", makeUser({ id: 50, name: "Dr. Meenakshi Iyer", role: "faculty" }));
const png = (name = "cover.png", type = "image/png", size = 200) => new File([new Uint8Array(size)], name, { type });

// The cover preview inside the form, not the app logo in the sidebar.
const coverImage = () => screen.getByLabelText(/^Cover image link/).closest("form").querySelector("img");

const formRoutes = (extra = {}) => ({ "GET /events/categories": () => ({ body: ["Workshop", "Seminar"] }), ...extra });

describe("cover image upload", () => {
  it("uploads the chosen file, shows it as the cover, and can remove it", async () => {
    signInOrganiser();
    const { calls } = installFakeApi(formRoutes({ "POST /uploads/event-image": () => ({ status: 201, body: { url: "/api/uploads/abc.png" } }) }));
    const ui = userEvent.setup();
    renderApp("/events/new");

    expect(await screen.findByRole("button", { name: "Upload image" })).toBeInTheDocument();
    await ui.upload(screen.getByLabelText("Choose a cover image file"), png());

    expect(await screen.findByText(/Image uploaded/)).toBeInTheDocument();
    const upload = calls.find((c) => c.path === "/uploads/event-image");
    expect(upload.method).toBe("POST");
    expect(upload.body.file.name).toBe("cover.png");
    expect(upload.headers["Content-Type"]).toBeUndefined(); // the browser sets the multipart boundary
    expect(upload.headers.Authorization).toBe("Bearer tok");

    expect(coverImage().getAttribute("src")).toMatch(/\/api\/uploads\/abc\.png$/);
    expect(screen.getByLabelText(/^Cover image link/)).toHaveValue("/api/uploads/abc.png");
    expect(screen.getByRole("button", { name: "Replace image" })).toBeInTheDocument();

    await ui.click(screen.getByRole("button", { name: "Remove image" }));
    expect(coverImage()).toBeNull();
    expect(screen.getByLabelText(/^Cover image link/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Upload image" })).toBeInTheDocument();
  });

  it("sends the uploaded link with the event when it is saved", async () => {
    signInOrganiser();
    const { calls } = installFakeApi(formRoutes({
      "POST /uploads/event-image": () => ({ status: 201, body: { url: "/api/uploads/abc.png" } }),
      "POST /events/": () => ({ status: 201, body: makeEvent({ id: 90 }) }),
      "GET /events/90": () => ({ body: makeEvent({ id: 90 }) }),
    }));
    const ui = userEvent.setup();
    renderApp("/events/new");

    await ui.upload(await screen.findByLabelText("Choose a cover image file"), png());
    await screen.findByText(/Image uploaded/);
    await ui.type(screen.getByLabelText(/^Title/), "Quiz");
    await ui.selectOptions(screen.getByLabelText(/^Category/), "Workshop");
    await ui.type(screen.getByLabelText(/^Venue/), "Hall");
    await ui.type(screen.getByLabelText(/^Starts/), "2030-05-01T10:00");
    await ui.type(screen.getByLabelText(/^Ends/), "2030-05-01T12:00");
    await ui.type(screen.getByLabelText(/^Capacity/), "5");
    await ui.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/events/")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/events/").body.image_url).toBe("/api/uploads/abc.png");
  });

  it("refuses the wrong type or a large file before sending anything", async () => {
    signInOrganiser();
    const { calls } = installFakeApi(formRoutes());
    const ui = userEvent.setup({ applyAccept: false });
    renderApp("/events/new");
    const input = await screen.findByLabelText("Choose a cover image file");

    await ui.upload(input, png("notes.txt", "text/plain"));
    expect(await screen.findByText("Use a PNG, JPEG, GIF or WebP image.")).toBeInTheDocument();

    await ui.upload(input, png("big.png", "image/png", 3 * 1024 * 1024));
    expect(await screen.findByText("Use an image under 2 MB.")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/uploads/event-image")).toBe(false);
  });

  it("shows the server reason when it refuses the file", async () => {
    signInOrganiser();
    installFakeApi(formRoutes({
      "POST /uploads/event-image": () => ({ status: 400, body: { error: "Use a PNG, JPEG, GIF or WebP image", fields: { file: "Not a supported image" } } }),
    }));
    const ui = userEvent.setup();
    renderApp("/events/new");
    await ui.upload(await screen.findByLabelText("Choose a cover image file"), png());
    expect(await screen.findByText("Not a supported image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeEnabled();
  });
});

describe("duplicate event", () => {
  it("prefills a new event from an old one, without the dates", async () => {
    signInOrganiser();
    const original = makeEvent({ id: 5, title: "Robotics workshop", venue: "Innovation Lab", capacity: 30, category: "Seminar", description: "Hands on." });
    installFakeApi(formRoutes({ "GET /events/5": () => ({ body: original }) }));
    renderApp("/events/new?copy=5");

    expect(await screen.findByDisplayValue("Copy of Robotics workshop")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Venue/)).toHaveValue("Innovation Lab");
    expect(screen.getByLabelText(/^Capacity/)).toHaveValue(30);
    expect(screen.getByLabelText(/^Category/)).toHaveValue("Seminar");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Hands on.");
    expect(screen.getByLabelText(/^Starts/)).toHaveValue("");
    expect(screen.getByLabelText(/^Ends/)).toHaveValue("");
    expect(screen.getByText(/Copied from "Robotics workshop"/)).toBeInTheDocument();
  });

  it("is offered on an event the organiser manages", async () => {
    signInOrganiser();
    installFakeApi({ "GET /events/5": () => ({ body: makeEvent({ id: 5, organizer_id: 50 }) }) });
    renderApp("/events/5");
    expect(await screen.findByRole("link", { name: "Duplicate event" })).toHaveAttribute("href", "/events/new?copy=5");
  });
});

describe("removing a participant", () => {
  const person = (id, name, status, position = null) => ({
    registration_id: id, user_id: id + 100, name, email: `${name.split(" ")[0].toLowerCase()}@campus-demo.test`,
    department: "School of Law", status, waitlist_position: position, registered_at: new Date().toISOString(),
  });

  it("asks first, then removes the person and says so", async () => {
    signInOrganiser();
    const event = makeEvent({ id: 9, organizer_id: 50, waitlisted_count: 1, registered_count: 1, seats_left: 0 });
    let people = [person(1, "Asha Rao", "registered"), person(2, "Ravi Nair", "waitlisted", 1)];
    const { calls } = installFakeApi({
      "GET /events/9": () => ({ body: event }),
      "GET /events/9/participants": () => ({ body: page(people) }),
      "DELETE /events/9/participants/1": () => {
        people = [person(2, "Ravi Nair", "registered")];
        return { body: { status: "cancelled", waitlist_position: null, message: "Asha Rao was removed" } };
      },
    });
    const ui = userEvent.setup();
    renderApp("/events/9/participants");

    await ui.click(await screen.findByRole("button", { name: "Remove Asha Rao" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Asha Rao?" });
    expect(within(dialog).getByText(/next person on the waitlist gets it/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await ui.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Asha Rao was removed")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("cell", { name: "Asha Rao" })).not.toBeInTheDocument());
    expect(screen.getByRole("cell", { name: "Ravi Nair" })).toBeInTheDocument();
  });

  it("can be cancelled from the dialog", async () => {
    signInOrganiser();
    const { calls } = installFakeApi({
      "GET /events/9": () => ({ body: makeEvent({ id: 9, organizer_id: 50 }) }),
      "GET /events/9/participants": () => ({ body: page([person(1, "Asha Rao", "registered")]) }),
    });
    const ui = userEvent.setup();
    renderApp("/events/9/participants");
    await ui.click(await screen.findByRole("button", { name: "Remove Asha Rao" }));
    await ui.click(await screen.findByRole("button", { name: "Keep them" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
