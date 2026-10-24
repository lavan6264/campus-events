import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { installFakeApi, makeUser, page } from "./fakeApi.js";
import { renderApp } from "./renderApp.jsx";

const signedInRoutes = () => ({
  "GET /events/": () => ({ body: page([]) }),
  "GET /me/registrations": () => ({ body: page([]) }),
  "GET /events/categories": () => ({ body: ["Workshop"] }),
});

describe("login", () => {
  it("signs in and lands on the dashboard", async () => {
    const user = makeUser();
    const { calls } = installFakeApi({
      "POST /auth/login": () => ({ body: { access_token: "tok", token_type: "bearer", user } }),
      ...signedInRoutes(),
    });
    const ui = userEvent.setup();
    renderApp("/login");

    await ui.type(screen.getByLabelText(/^email/i), "Aarav@Campus-Demo.test");
    await ui.type(screen.getByLabelText(/^password/i), "student123");
    await ui.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    const login = calls.find((c) => c.path === "/auth/login");
    expect(login.body).toEqual({ email: "Aarav@Campus-Demo.test", password: "student123" });
    expect(login.headers.Authorization).toBeUndefined();
    // The next requests carry the token.
    await waitFor(() => expect(calls.some((c) => c.path === "/events/" && c.headers.Authorization === "Bearer tok")).toBe(true));
    expect(localStorage.getItem("ce.token")).toBe("tok");
  });

  it("shows the server's message when the password is wrong", async () => {
    installFakeApi({ "POST /auth/login": () => ({ status: 401, body: { error: "Incorrect email or password" } }) });
    const ui = userEvent.setup();
    renderApp("/login");

    await ui.type(screen.getByLabelText(/^email/i), "a@b.test");
    await ui.type(screen.getByLabelText(/^password/i), "wrong-pass");
    await ui.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(localStorage.getItem("ce.token")).toBeNull();
  });

  it("checks the fields before sending anything", async () => {
    const { calls } = installFakeApi({});
    const ui = userEvent.setup();
    renderApp("/login");

    await ui.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await ui.type(screen.getByLabelText(/^email/i), "not-an-email");
    await ui.tab();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("fills the form from a demo account button", async () => {
    installFakeApi({});
    const ui = userEvent.setup();
    renderApp("/login");
    await ui.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByLabelText(/^email/i)).toHaveValue("admin@campus-demo.test");
    expect(screen.getByLabelText(/^password/i)).toHaveValue("admin123");
  });

  it("sends signed out visitors to the login page", async () => {
    installFakeApi({});
    renderApp("/events");
    expect(await screen.findByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("register", () => {
  it("creates an account and signs in", async () => {
    const created = makeUser({ id: 9, name: "Isha Gupta", email: "isha@campus-demo.test", role: "faculty" });
    const { calls } = installFakeApi({
      "POST /auth/register": () => ({ status: 201, body: { access_token: "tok2", token_type: "bearer", user: created } }),
      ...signedInRoutes(),
    });
    const ui = userEvent.setup();
    renderApp("/login");

    await ui.click(screen.getByRole("tab", { name: "Create account" }));
    await ui.type(screen.getByLabelText(/full name/i), "Isha Gupta");
    await ui.type(screen.getByLabelText(/^email/i), "isha@campus-demo.test");
    await ui.type(screen.getByLabelText(/^password/i), "longenough1");
    await ui.selectOptions(screen.getByLabelText(/i am a/i), "faculty");
    await ui.selectOptions(screen.getByLabelText(/department/i), "School of Law");
    await ui.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/register").body).toEqual({
      name: "Isha Gupta", email: "isha@campus-demo.test", password: "longenough1",
      role: "faculty", department: "School of Law",
    });
  });

  it("shows server field errors under the right inputs", async () => {
    installFakeApi({
      "POST /auth/register": () => ({
        status: 409,
        body: { error: "Email already in use", fields: { email: "Already in use" } },
      }),
    });
    const ui = userEvent.setup();
    renderApp("/login");

    await ui.click(screen.getByRole("tab", { name: "Create account" }));
    await ui.type(screen.getByLabelText(/full name/i), "Isha Gupta");
    await ui.type(screen.getByLabelText(/^email/i), "isha@campus-demo.test");
    await ui.type(screen.getByLabelText(/^password/i), "longenough1");
    await ui.click(screen.getByRole("button", { name: "Create account" }));

    const email = screen.getByLabelText(/^email/i);
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(within(email.closest("div")).getByText("Already in use")).toBeInTheDocument();
    expect(email).toHaveFocus();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("validates the password length like the server does", async () => {
    const { calls } = installFakeApi({});
    const ui = userEvent.setup();
    renderApp("/login");
    await ui.click(screen.getByRole("tab", { name: "Create account" }));
    await ui.type(screen.getByLabelText(/full name/i), "Isha");
    await ui.type(screen.getByLabelText(/^email/i), "isha@campus-demo.test");
    await ui.type(screen.getByLabelText(/^password/i), "short");
    await ui.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use at least 8 characters")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
