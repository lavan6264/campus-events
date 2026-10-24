// Walks the required flow in a real browser against the running app:
// Login, Dashboard, Explore, Register, Manage participants, View reports.
// Needs the API on :8000 (freshly seeded) and the frontend on :5173. Also saves screenshots.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const shots = resolve(here, "../../docs/screenshots");
mkdirSync(shots, { recursive: true });
const APP = process.env.APP_URL || "http://localhost:5173";

let browser;
for (const channel of ["msedge", "chrome"]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* try the next */
  }
}
if (!browser) throw new Error("No Edge or Chrome found.");

const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// Failed HTTP responses are expected where a step provokes them (422, 404, 403), so only real errors count.
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`console: ${m.text()}`));

let step = 0;
const ok = (message) => console.log(`ok ${String(++step).padStart(2, "0")}  ${message}`);
const check = (condition, message) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  ok(message);
};
const shot = (name) => page.screenshot({ path: resolve(shots, `${name}.png`) });

async function signIn(demo) {
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: demo, exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  try {
    await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  } catch (error) {
    await shot("e2e-failure");
    console.log(`Sign in as ${demo} failed at ${page.url()}
${(await page.locator("body").innerText()).slice(0, 400)}`);
    throw error;
  }
}

async function signOut() {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("tab", { name: "Sign in" }).waitFor();
}

// 1. Student: dashboard, explore, register, cancel
await signIn("Student");
ok("student signs in and lands on the dashboard");

await page.getByRole("link", { name: "Explore events" }).first().click();
await page.getByRole("heading", { name: "Explore events" }).waitFor();
await page.getByRole("link", { name: "Data science with Python" }).click();
await page.getByRole("heading", { name: "Data science with Python" }).waitFor();
await shot("event-detail-glass");
check(await page.getByRole("button", { name: "Register", exact: true }).isVisible(), "event detail offers Register");

await page.getByRole("button", { name: "Register", exact: true }).click();
await page.getByText("You are registered").first().waitFor();
check(await page.getByRole("button", { name: "Cancel registration" }).isVisible(), "registering switches the panel to Cancel registration");

await page.getByRole("button", { name: "Cancel registration" }).click();
await page.getByRole("button", { name: "Register", exact: true }).waitFor();
ok("cancelling returns the panel to Register");

// clash message: register for a confirmed overlap
await page.goto(`${APP}/events?q=Robotics line`);
await page.getByRole("link", { name: "Robotics line follower contest" }).click();
await page.getByRole("heading", { name: "Robotics line follower contest" }).waitFor();
check(await page.getByRole("button", { name: "Cancel registration" }).isVisible(), "seeded registration shows as registered");

// AI search toggle
await page.goto(`${APP}/events`);
await page.getByRole("tab", { name: "Describe what you want" }).click();
await page.getByLabel("Describe what you want").fill("robotics workshops next week");
await page.getByRole("button", { name: "Find events" }).click();
await page.getByRole("status").filter({ hasText: /Filters from AI|keyword search/ }).waitFor();
await shot("explore-ai-glass");
const aiNote = (await page.getByRole("status").filter({ hasText: /Filters from AI|keyword search/ }).innerText()).trim();
check(/Filters from AI|keyword search/.test(aiNote), `AI search reports its source: "${aiNote.slice(0, 60)}..."`);
check(page.url().includes("category=Workshop"), "AI filters are written to the URL");
await signOut();

// 2. Faculty: create with AI draft, participants, CSV, edit, delete
await signIn("Faculty");
await page.getByRole("link", { name: "My events" }).first().click();
await page.getByRole("heading", { name: "My events" }).waitFor();
await shot("my-events-glass");

await page.getByRole("link", { name: "Create event" }).first().click();
await page.getByRole("heading", { name: "Create event" }).waitFor();
await page.getByLabel("Draft with AI").first().fill("intro to drone building, saturday morning, innovation lab, beginners welcome");
await page.getByRole("button", { name: "Draft with AI" }).click();
await page.getByText(/Drafted by AI|AI is not available/).waitFor();
const draftNote = await page.getByText(/Drafted by AI|AI is not available/).innerText();
ok(`draft assistant answered: "${draftNote.slice(0, 50)}..."`);
const draftedTitle = await page.getByLabel(/^Title/).inputValue();
if (!draftedTitle) await page.getByLabel(/^Title/).fill("Intro to drone building");
if (!(await page.getByLabel(/^Category/).inputValue())) await page.getByLabel(/^Category/).selectOption("Workshop");
await page.getByLabel(/^Venue/).fill("Innovation Lab");
const start = new Date(Date.now() + 20 * 86400000);
start.setHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 3 * 3600000);
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
await page.getByLabel(/^Starts/).fill(local(start));
await page.getByLabel(/^Ends/).fill(local(end));
await page.getByLabel(/^Capacity/).fill("2");
await shot("event-form-glass");

// client side validation mirrors the server
await page.getByLabel(/^Ends/).fill(local(new Date(start.getTime() - 3600000)));
await page.getByRole("button", { name: "Create event" }).click();
await page.getByText("Must be after the start time").waitFor();
ok("an end time before the start is rejected before any request");
await page.getByLabel(/^Ends/).fill(local(end));
await page.getByRole("button", { name: "Create event" }).click();
await page.getByText("Event created").waitFor();
const eventUrl = page.url();
check(/\/events\/\d+$/.test(eventUrl), `event created and opened at ${eventUrl.replace(APP, "")}`);

// two students fill it, a third is waitlisted; then manage participants
const eventId = eventUrl.split("/").pop();
await signOut();
for (const email of ["aarav.sharma@campus-demo.test", "ananya.reddy@campus-demo.test", "vihaan.patel@campus-demo.test"]) {
  await page.goto(`${APP}/login`);
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill("student123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.goto(`${APP}/events/${eventId}`);
  const join = page.getByRole("button", { name: /^(Register|Join waitlist)$/ });
  await join.waitFor();
  const label = await join.innerText();
  await join.click();
  await page.getByText(/You are registered|You are on the waitlist|The event is full/).first().waitFor();
  ok(`${email.split(".")[0]} pressed "${label}"`);
  await signOut();
}

await signIn("Faculty");
await page.goto(`${APP}/events/${eventId}/participants`);
await page.getByRole("heading", { name: /Participants/ }).waitFor();
await page.getByRole("cell", { name: "Vihaan Patel" }).waitFor();
await shot("participants-glass");
check(await page.getByText(/Waitlisted, position 1/).isVisible(), "the third student is on the waitlist at position 1");
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
check(download.suggestedFilename() === `event-${eventId}-participants.csv`, `CSV downloads as ${download.suggestedFilename()}`);

// edit: raise capacity, waitlisted student is promoted
await page.goto(`${APP}/events/${eventId}/edit`);
await page.getByLabel(/^Capacity/).fill("3");
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByText("Event saved").waitFor();
await page.goto(`${APP}/events/${eventId}/participants`);
await page.getByRole("cell", { name: "Vihaan Patel" }).waitFor();
check(!(await page.getByText(/Waitlisted, position/).isVisible()), "raising capacity promoted the waitlisted student");

// lowering below confirmed is refused with a message on the field
await page.goto(`${APP}/events/${eventId}/edit`);
await page.getByLabel(/^Capacity/).fill("1");
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByText(/Must be at least 3/).waitFor();
ok("capacity below the confirmed count is refused, with the reason under the field");

await page.goto(`${APP}/events/${eventId}`);
await page.getByRole("button", { name: "Delete event" }).click();
await shot("delete-dialog-glass");
await page.getByRole("dialog").getByRole("button", { name: "Delete event" }).click();
await page.getByRole("heading", { name: "Explore events" }).waitFor();
ok("event deleted after confirming in the dialog");
await signOut();

// 3. Admin: reports
await signIn("Admin");
await page.getByRole("link", { name: "Reports" }).first().click();
await page.getByRole("heading", { name: "Registrations per day" }).waitFor();
await page.getByText(/Written by AI|Built from the numbers/).waitFor();
await page.waitForTimeout(400);
await shot("reports-glass");
const summaryNote = await page.getByText(/Written by AI|Built from the numbers/).innerText();
ok(`reports show the AI summary with its source: "${summaryNote.slice(0, 45)}..."`);
await page.getByRole("button", { name: "View as table" }).first().click();
check(await page.getByRole("table", { name: "Registrations per day" }).isVisible(), "a chart can be read as a table");

// role change (search first: the users table is paged)
await page.getByLabel("Search users").fill("Diya Nair");
await page.getByLabel("Role for Diya Nair").waitFor();
await page.getByLabel("Role for Diya Nair").selectOption("faculty");
await page.getByText("Diya Nair is now a faculty user").waitFor();
await page.getByLabel("Role for Diya Nair").selectOption("student");
await page.getByText("Diya Nair is now a student user").waitFor();
ok("admin changes a role and changes it back");
await page.getByLabel("Search users").fill("Admin");
await page.getByLabel("Role for Admin").waitFor();
check(await page.getByLabel("Role for Admin").isDisabled(), "an admin cannot change their own role");

// 404 and 403
await page.goto(`${APP}/events/999999`);
await page.getByRole("heading", { name: "Page not found" }).waitFor();
await shot("not-found-glass");
ok("an unknown event shows the 404 page");
await signOut();
await signIn("Student");
await page.goto(`${APP}/reports`);
await page.getByRole("heading", { name: "You cannot open this page" }).waitFor();
ok("a student opening /reports sees the 403 page");

await browser.close();
if (errors.length) {
  console.log("\nBrowser errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nAll steps passed with no browser errors.");
}
