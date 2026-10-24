import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { session } from "../lib/crud/api.js";
import { installFakeApi, makeEvent, makeUser, page } from "./fakeApi.js";
import { renderApp } from "./renderApp.jsx";

const signIn = (overrides) => {
  const user = makeUser(overrides);
  session.set("tok", user);
  return user;
};

const DAY = 86400000;

/** An event page with a registration endpoint that records what was asked. */
function detailRoutes(event, extra = {}) {
  let current = event;
  return {
    "GET /events/categories": () => ({ body: ["Workshop"] }),
    [`GET /events/${event.id}`]: () => ({ body: current }),
    ...extra,
    __set: (next) => {
      current = { ...current, ...next };
    },
  };
}

describe("event detail", () => {
  it("registers, then offers to cancel", async () => {
    const event = makeEvent({ id: 7, title: "Robotics workshop" });
    signIn();
    const routes = detailRoutes(event);
    routes["POST /events/7/register"] = () => {
      routes.__set({ my_status: "registered", registered_count: 6, seats_left: 14 });
      return { status: 201, body: { status: "registered", waitlist_position: null, message: "You are registered" } };
    };
    routes["DELETE /events/7/register"] = () => {
      routes.__set({ my_status: null, registered_count: 5, seats_left: 15 });
      return { body: { status: "cancelled", waitlist_position: null, message: "Your registration is cancelled" } };
    };
    const { calls } = installFakeApi(routes);
    const ui = userEvent.setup();
    renderApp("/events/7");

    expect(await screen.findByText("15 seats left")).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByRole("button", { name: "Cancel registration" })).toBeInTheDocument();
    expect(await screen.findByText("You are registered", { selector: "span" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.path === "/events/7/register")).toBe(true);

    await ui.click(screen.getByRole("button", { name: "Cancel registration" }));
    expect(await screen.findByRole("button", { name: "Register" })).toBeInTheDocument();
  });

  it("offers the waitlist when the event is full, and shows the position when on it", async () => {
    signIn();
    const full = makeEvent({ id: 8, seats_left: 0, registered_count: 20, waitlisted_count: 2 });
    installFakeApi(detailRoutes(full));
    const { unmount } = renderApp("/events/8");
    expect(await screen.findByRole("button", { name: "Join waitlist" })).toBeInTheDocument();
    expect(screen.getByText("Full, 2 waiting")).toBeInTheDocument();
    unmount();

    const waiting = makeEvent({ id: 9, seats_left: 0, my_status: "waitlisted", my_waitlist_position: 3 });
    installFakeApi(detailRoutes(waiting));
    renderApp("/events/9");
    expect(await screen.findByText("On the waitlist, position 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave waitlist" })).toBeInTheDocument();
  });

  it("warns about a clash and does not let the person register into it", async () => {
    signIn();
    const clash = makeEvent({ id: 10, clash_with_title: "Hack night", clash_with_id: 3 });
    installFakeApi(detailRoutes(clash));
    renderApp("/events/10");
    expect(await screen.findByText(/clashes with "Hack night"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeDisabled();
  });

  it("shows the reason when registration is closed", async () => {
    signIn();
    const ended = makeEvent({
      id: 11,
      start_time: new Date(Date.now() - 2 * DAY).toISOString(),
      end_time: new Date(Date.now() - 2 * DAY + 3600000).toISOString(),
    });
    installFakeApi(detailRoutes(ended));
    const { unmount } = renderApp("/events/11");
    expect(await screen.findByText("Registration closed, event ended.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
    unmount();

    installFakeApi(detailRoutes(makeEvent({ id: 12, status: "cancelled" })));
    renderApp("/events/12");
    expect(await screen.findByText("Registration closed, event cancelled.")).toBeInTheDocument();
  });

  it("shows management actions to the organizer and an admin, not to other students", async () => {
    const event = makeEvent({ id: 13, organizer_id: 50 });
    signIn({ id: 1, role: "student" });
    installFakeApi(detailRoutes(event));
    const { unmount } = renderApp("/events/13");
    await screen.findByRole("button", { name: "Register" });
    expect(screen.queryByRole("link", { name: "Manage participants" })).not.toBeInTheDocument();
    unmount();

    signIn({ id: 50, role: "faculty" });
    installFakeApi(detailRoutes(event));
    renderApp("/events/13");
    expect(await screen.findByRole("link", { name: "Manage participants" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit event" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete event" })).toBeInTheDocument();
  });

  it("asks before deleting and then returns to the list", async () => {
    signIn({ id: 50, role: "faculty" });
    const event = makeEvent({ id: 14, organizer_id: 50, title: "Quiz night" });
    const routes = detailRoutes(event, {
      "DELETE /events/14": () => ({ status: 204 }),
      "GET /events/": () => ({ body: page([]) }),
    });
    const { calls } = installFakeApi(routes);
    const ui = userEvent.setup();
    renderApp("/events/14");

    await ui.click(await screen.findByRole("button", { name: "Delete event" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this event?" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await ui.click(within(dialog).getByRole("button", { name: "Delete event" }));
    expect(await screen.findByRole("heading", { name: "Explore events" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/events/14")).toBe(true);
  });

  it("shows the 404 page for an event that does not exist", async () => {
    signIn();
    installFakeApi({ "GET /events/999": () => ({ status: 404, body: { error: "Event not found" } }) });
    renderApp("/events/999");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});


describe("create event", () => {
  const routes = (extra = {}) => ({ "GET /events/categories": () => ({ body: ["Workshop", "Seminar"] }), ...extra });

  it("fills the form from an AI draft and saves nothing until the person submits", async () => {
    signIn({ id: 50, role: "faculty" });
    const { calls } = installFakeApi(
      routes({
        "POST /ai/draft-event": () => ({
          body: { source: "ai", title: "Intro to drones", description: "Build a small drone.", category: "Workshop" },
        }),
      }),
    );
    const ui = userEvent.setup();
    renderApp("/events/new");

    await ui.type(await screen.findByLabelText("Draft with AI", { selector: "textarea" }), "drone session saturday lab");
    await ui.click(screen.getByRole("button", { name: "Draft with AI" }));

    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveValue("Intro to drones"));
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Build a small drone.");
    expect(screen.getByLabelText(/^Category/)).toHaveValue("Workshop");
    expect(screen.getByText("Drafted by AI. Check every detail before you save.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.path === "/events/")).toBe(false);
  });

  it("says so when AI is unavailable and the notes become the description", async () => {
    signIn({ id: 50, role: "faculty" });
    installFakeApi(
      routes({ "POST /ai/draft-event": () => ({ body: { source: "fallback", title: "", description: "drone session", category: null } }) }),
    );
    const ui = userEvent.setup();
    renderApp("/events/new");
    await ui.type(await screen.findByLabelText("Draft with AI", { selector: "textarea" }), "drone session");
    await ui.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(await screen.findByText(/AI is not available right now/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("drone session");
  });

  it("rejects an end before the start without calling the server, and maps server field errors", async () => {
    signIn({ id: 50, role: "faculty" });
    const { calls } = installFakeApi(
      routes({
        "POST /events/": () => ({
          status: 422,
          body: { error: "Please fix the highlighted fields", fields: { capacity: "Must be greater than 0" } },
        }),
      }),
    );
    const ui = userEvent.setup();
    renderApp("/events/new");

    await ui.type(await screen.findByLabelText(/^Title/), "Quiz");
    await ui.selectOptions(screen.getByLabelText(/^Category/), "Workshop");
    await ui.type(screen.getByLabelText(/^Venue/), "Hall");
    await ui.type(screen.getByLabelText(/^Starts/), "2030-05-01T10:00");
    await ui.type(screen.getByLabelText(/^Ends/), "2030-05-01T09:00");
    await ui.type(screen.getByLabelText(/^Capacity/), "5");
    await ui.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByText("Must be after the start time")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await ui.clear(screen.getByLabelText(/^Ends/));
    await ui.type(screen.getByLabelText(/^Ends/), "2030-05-01T12:00");
    await ui.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByText("Must be greater than 0")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Capacity/)).toHaveAttribute("aria-invalid", "true");
  });

  it("sends students who open the create page to the 403 page", async () => {
    signIn({ role: "student" });
    installFakeApi(routes());
    renderApp("/events/new");
    expect(await screen.findByRole("heading", { name: "You cannot open this page" })).toBeInTheDocument();
  });
});

describe("explore with AI search", () => {
  it("applies what the AI understood to the URL filters and says where it came from", async () => {
    signIn();
    const { calls } = installFakeApi({
      "GET /events/categories": () => ({ body: ["Workshop"] }),
      "GET /events/": () => ({ body: page([]) }),
      "POST /ai/search": () => ({
        body: {
          source: "ai",
          filters: { q: "robotics", category: "Workshop", start_time__gte: "2030-05-06T00:00:00+00:00", start_time__lte: "2030-05-12T23:59:59+00:00" },
          summary: 'Showing Workshop events matching "robotics" from 06 May to 12 May',
        },
      }),
    });
    const ui = userEvent.setup();
    const { router } = renderApp("/events");

    await ui.click(await screen.findByRole("tab", { name: "Describe what you want" }));
    await ui.type(screen.getByLabelText("Describe what you want", { selector: "input" }), "robotics workshops next week");
    await ui.click(screen.getByRole("button", { name: "Find events" }));

    expect(await screen.findByText(/Filters from AI/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/ai/search").body).toEqual({ query: "robotics workshops next week" });
    await waitFor(() => {
      const search = router.state.location.search;
      expect(search).toContain("q=robotics");
      expect(search).toContain("category=Workshop");
      expect(search).toContain("from=2030-05-06");
      expect(search).toContain("to=2030-05-12");
    });
    // The same filters now drive the list request.
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === "/events/");
      expect(last.params).toMatchObject({ q: "robotics", category: "Workshop", start_time__gte: "2030-05-06" });
      expect(last.params.start_time__lte).toBe("2030-05-12T23:59:59");
    });
  });

  it("labels the keyword fallback honestly", async () => {
    signIn();
    installFakeApi({
      "GET /events/categories": () => ({ body: [] }),
      "GET /events/": () => ({ body: page([]) }),
      "POST /ai/search": () => ({ body: { source: "fallback", filters: { q: "coding" }, summary: 'Showing events matching "coding"' } }),
    });
    const ui = userEvent.setup();
    renderApp("/events");
    await ui.click(await screen.findByRole("tab", { name: "Describe what you want" }));
    await ui.type(screen.getByLabelText("Describe what you want", { selector: "input" }), "coding");
    await ui.click(screen.getByRole("button", { name: "Find events" }));
    expect(await screen.findByText(/AI is not available right now, so this is a keyword search/)).toBeInTheDocument();
  });
});

describe("signing out", () => {
  it("does not hand the next person the last person's page", async () => {
    signIn({ role: "student" });
    installFakeApi({
      "GET /events/categories": () => ({ body: [] }),
      "GET /events/": () => ({ body: page([]) }),
      "GET /me/registrations": () => ({ body: page([]) }),
      "POST /auth/login": () => ({
        body: { access_token: "t2", token_type: "bearer", user: makeUser({ id: 2, name: "Next Person", role: "admin" }) },
      }),
    });
    const ui = userEvent.setup();
    const { router } = renderApp("/events?category=Workshop");
    await ui.click(await screen.findByRole("button", { name: "Sign out" }));
    await screen.findByRole("tab", { name: "Sign in" });
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toBeNull();

    await ui.type(screen.getByLabelText(/^email/i), "next@campus-demo.test");
    await ui.type(screen.getByLabelText(/^password/i), "password123");
    await ui.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("role based navigation", () => {
  const nav = async (role) => {
    signIn({ role });
    installFakeApi({ "GET /events/": () => ({ body: page([]) }), "GET /me/registrations": () => ({ body: page([]) }), "GET /me/events": () => ({ body: page([]) }) });
    renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });
    const primary = screen.getByRole("navigation", { name: "Primary" });
    return [...primary.querySelectorAll("a")].map((a) => a.textContent);
  };

  it("shows each role only what it can use", async () => {
    expect(await nav("student")).toEqual(["Dashboard", "Explore events"]);
  });

  it("adds My events for organisers", async () => {
    expect(await nav("faculty")).toEqual(["Dashboard", "Explore events", "My events"]);
  });

  it("adds Reports for admins", async () => {
    expect(await nav("admin")).toEqual(["Dashboard", "Explore events", "My events", "Reports"]);
  });
});


describe("theme", () => {
  it("switches between dark and light, remembers the choice, and says what the button will do", async () => {
    signIn();
    installFakeApi({ "GET /events/": () => ({ body: page([]) }), "GET /me/registrations": () => ({ body: page([]) }) });
    const ui = userEvent.setup();
    renderApp("/");

    await ui.click(await screen.findByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("ce.theme")).toBe("light");

    await ui.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ce.theme")).toBe("dark");
  });

  it("is also available on the sign in page", async () => {
    installFakeApi({});
    const ui = userEvent.setup();
    renderApp("/login");
    await ui.click(await screen.findByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("event cards", () => {
  const cardsRoutes = (items, extra = {}) => ({
    "GET /events/categories": () => ({ body: ["Workshop"] }),
    "GET /events/": () => ({ body: page(items) }),
    ...extra,
  });
  const card = (title) => screen.getByRole("heading", { name: title }).closest("article");

  it("shows cover, details, seat count and an Enroll button, and enrolls from the card", async () => {
    signIn();
    const event = makeEvent({ id: 31, title: "Data science with Python", venue: "Innovation Lab", organizer_name: "Dr. Meenakshi Iyer" });
    let current = event;
    const routes = cardsRoutes([event], {
      "POST /events/31/register": () => {
        current = { ...event, my_status: "registered", registered_count: 6, seats_left: 14 };
        return { status: 201, body: { status: "registered", waitlist_position: null, message: "You are registered" } };
      },
    });
    routes["GET /events/"] = () => ({ body: page([current]) });
    const { calls } = installFakeApi(routes);
    const ui = userEvent.setup();
    renderApp("/events");

    const article = await waitFor(() => card("Data science with Python"));
    expect(article).toHaveTextContent("15 seats left of 20");
    expect(within(article).getByText("Innovation Lab")).toBeInTheDocument();
    expect(within(article).getByText("By Dr. Meenakshi Iyer")).toBeInTheDocument();
    expect(article.querySelector("svg")).not.toBeNull(); // the drawn cover

    await ui.click(within(article).getByRole("button", { name: "Enroll in Data science with Python" }));
    expect(await screen.findByRole("button", { name: "Cancel enrollment in Data science with Python" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.path === "/events/31/register")).toBe(true);
    expect(within(card("Data science with Python")).getByText("Registered")).toBeInTheDocument();
  });

  it("offers the right action for each state", async () => {
    signIn();
    const items = [
      makeEvent({ id: 41, title: "Full workshop", seats_left: 0, registered_count: 20, waitlisted_count: 3 }),
      makeEvent({ id: 42, title: "Waiting for a seat", seats_left: 0, my_status: "waitlisted", my_waitlist_position: 2 }),
      makeEvent({ id: 43, title: "Clashing talk", clash_with_title: "Hack night", clash_with_id: 1 }),
      makeEvent({ id: 44, title: "Old quiz", start_time: new Date(Date.now() - 3 * DAY).toISOString(), end_time: new Date(Date.now() - 3 * DAY + 3600000).toISOString() }),
      makeEvent({ id: 45, title: "Called off", status: "cancelled" }),
    ];
    installFakeApi(cardsRoutes(items));
    renderApp("/events");
    await waitFor(() => card("Full workshop"));

    expect(within(card("Full workshop")).getByText("Full, 3 waiting")).toBeInTheDocument();
    expect(within(card("Full workshop")).getByRole("button", { name: /Join the waitlist/ })).toBeEnabled();
    expect(within(card("Waiting for a seat")).getByText("Waitlisted, position 2")).toBeInTheDocument();
    expect(within(card("Waiting for a seat")).getByRole("button", { name: /Leave the waitlist/ })).toBeEnabled();
    expect(within(card("Clashing talk")).getByRole("button", { name: /unavailable: clashes with Hack night/ })).toBeDisabled();
    expect(within(card("Clashing talk")).getByText("Overlaps with Hack night")).toBeInTheDocument();
    expect(within(card("Old quiz")).getByRole("button", { name: "Event ended" })).toBeDisabled();
    expect(within(card("Called off")).getByRole("button", { name: "Cancelled" })).toBeDisabled();
  });

  it("switches between cards and the table, keeping the view in the URL", async () => {
    signIn();
    installFakeApi(cardsRoutes([makeEvent({ id: 51, title: "Quiz night" })]));
    const ui = userEvent.setup();
    const { router } = renderApp("/events");
    await waitFor(() => card("Quiz night"));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await ui.click(screen.getByRole("tab", { name: "Table" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(router.state.location.search).toContain("view=table");

    await ui.click(screen.getByRole("tab", { name: "Cards" }));
    await waitFor(() => card("Quiz night"));
    expect(router.state.location.search).not.toContain("view");
  });

  it("sorts cards with the Sort by control, and shows what to do when nothing matches", async () => {
    signIn();
    const { calls } = installFakeApi(cardsRoutes([makeEvent({ id: 61, title: "Quiz night" })]));
    const ui = userEvent.setup();
    renderApp("/events");
    await waitFor(() => card("Quiz night"));
    await ui.selectOptions(screen.getByLabelText("Sort by"), "-start_time");
    await waitFor(() => expect([...calls].reverse().find((c) => c.path === "/events/").params.sort).toBe("-start_time"));
  });

  it("shows an empty state with a next step", async () => {
    signIn();
    installFakeApi(cardsRoutes([]));
    renderApp("/events");
    expect(await screen.findByRole("heading", { name: "No events match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("gives organizers Participants and Edit buttons on their own events", async () => {
    signIn({ id: 50, role: "faculty" });
    installFakeApi({
      "GET /me/events": () => ({ body: page([makeEvent({ id: 71, title: "My workshop", organizer_id: 50 })]) }),
    });
    renderApp("/my-events");
    const article = await waitFor(() => card("My workshop"));
    expect(within(article).getByRole("link", { name: "Participants of My workshop" })).toHaveAttribute("href", "/events/71/participants");
    expect(within(article).getByRole("link", { name: "Edit My workshop" })).toHaveAttribute("href", "/events/71/edit");
    expect(within(article).queryByRole("button", { name: /Enroll/ })).not.toBeInTheDocument();
  });

  it("falls back to the drawn cover when an image link does not load, and uses the image when it does", async () => {
    signIn();
    installFakeApi(cardsRoutes([makeEvent({ id: 81, title: "With picture", image_url: "https://example.test/cover.jpg" })]));
    renderApp("/events");
    const article = await waitFor(() => card("With picture"));
    const img = article.querySelector("img");
    expect(img).toHaveAttribute("src", "https://example.test/cover.jpg");
    img.dispatchEvent(new Event("error"));
    await waitFor(() => expect(article.querySelector("img")).toBeNull());
    expect(article.querySelector("svg")).not.toBeNull();
  });
});
