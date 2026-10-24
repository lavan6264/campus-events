import { createResource } from "../lib/crud/createResource.js";

// Adding a REST resource to the app is one line each.
export const events = createResource("events", { singular: "event" });
export const users = createResource("users", { singular: "user" });
export const registrations = createResource("registrations", { singular: "registration" });

// Hand written API routes, read only.
export const myRegistrations = createResource("my-registrations", { singular: "registration", path: "/me/registrations", slash: false });
export const myEvents = createResource("my-events", { singular: "event", path: "/me/events", slash: false });
