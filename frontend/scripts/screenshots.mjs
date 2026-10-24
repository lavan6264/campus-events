// Takes the README screenshots of the main screens.
// Needs the API on :8000 (seeded) and the frontend on :5173. Uses an installed Microsoft Edge or Chrome.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../docs/screenshots");
mkdirSync(out, { recursive: true });

const APP = process.env.APP_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:8000/api";

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.json();
}

const channels = ["msedge", "chrome"];
let browser;
for (const channel of channels) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* try the next one */
  }
}
if (!browser) throw new Error("No Edge or Chrome found. Install one, or set up Playwright's own browser.");

const shots = [
  { name: "login", path: "/login", auth: false },
  { name: "dashboard", path: "/", auth: "student" },
  { name: "dashboard-organiser", path: "/", auth: "organiser" },
  { name: "my-events", path: "/my-events", auth: "organiser" },
  { name: "event-detail", path: "/events/8", auth: "student" },
  { name: "reports", path: "/reports", auth: "admin" },
  { name: "explore", path: "/events", auth: "student" },
  { name: "explore-mobile", path: "/events", auth: "student", viewport: { width: 390, height: 900 } },
  { name: "dashboard-mobile", path: "/", auth: "student", viewport: { width: 390, height: 900 } },
];

const accounts = {
  student: ["aarav.sharma@campus-demo.test", "student123"],
  organiser: ["organiser1@campus-demo.test", "organiser123"],
  admin: ["admin@campus-demo.test", "admin123"],
};
const sessions = {};
for (const key of new Set(shots.map((s) => s.auth).filter(Boolean))) sessions[key] = await login(...accounts[key]);

const themes = [
  { name: "dark", suffix: "" },
  { name: "light", suffix: "-light" },
];

for (const shot of shots.flatMap((s) => themes.filter((t) => t.name === "dark" || !s.viewport).map((t) => ({ ...s, theme: t })))) {
  const context = await browser.newContext({
    viewport: shot.viewport || { width: 1360, height: 860 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript((theme) => localStorage.setItem("ce.theme", theme), shot.theme.name);
  if (shot.auth) {
    const s = sessions[shot.auth];
    await context.addInitScript(([token, user]) => {
      localStorage.setItem("ce.token", token);
      localStorage.setItem("ce.user", user);
    }, [s.access_token, JSON.stringify(s.user)]);
  }
  const page = await context.newPage();
  await page.goto(APP + shot.path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(out, `${shot.name}${shot.theme.suffix}.png`), fullPage: false });
  console.log("saved", `${shot.name}${shot.theme.suffix}.png`);
  await context.close();
}
await browser.close();
