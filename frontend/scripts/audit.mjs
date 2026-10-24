// Responsive and accessibility audit of every screen, at phone, tablet and desktop widths.
// Checks: no horizontal scroll, touch targets on phones, axe-core violations, images and inputs have names.
// Needs the API on :8000 (seeded) and the frontend on :5173.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const APP = process.env.APP_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:8000/api";

const accounts = {
  student: ["aarav.sharma@campus-demo.test", "student123"],
  faculty: ["faculty1@campus-demo.test", "faculty123"],
  admin: ["admin@campus-demo.test", "admin123"],
};
const sessions = {};
for (const [key, [email, password]] of Object.entries(accounts)) {
  const res = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  sessions[key] = await res.json();
}
const events = await (await fetch(`${API}/events/?limit=1&sort=start_time`, { headers: { Authorization: `Bearer ${sessions.student.access_token}` } })).json();
const eventId = events.items[0].id;

const screens = [
  { name: "login", path: "/login" },
  { name: "dashboard (student)", path: "/", as: "student" },
  { name: "explore", path: "/events", as: "student" },
  { name: "event detail", path: `/events/${eventId}`, as: "student" },
  { name: "dashboard (admin)", path: "/", as: "admin" },
  { name: "my events", path: "/my-events", as: "faculty" },
  { name: "create event", path: "/events/new", as: "faculty" },
  { name: "edit event", path: `/events/${eventId}/edit`, as: "admin" },
  { name: "participants", path: `/events/${eventId}/participants`, as: "admin" },
  { name: "reports", path: "/reports", as: "admin" },
  { name: "403", path: "/reports", as: "student" },
  { name: "404", path: "/nowhere", as: "student" },
];
const viewports = [{ label: "360px", width: 360, height: 800 }, { label: "768px", width: 768, height: 900 }, { label: "1440px", width: 1440, height: 900 }];

let browser;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* next */ }
}
if (!browser) throw new Error("No Edge or Chrome found.");

const problems = [];
let checked = 0;
for (const vp of viewports) {
  for (const screen of screens) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
    if (screen.as) {
      const s = sessions[screen.as];
      await context.addInitScript(([t, u]) => { localStorage.setItem("ce.token", t); localStorage.setItem("ce.user", u); }, [s.access_token, JSON.stringify(s.user)]);
    }
    const page = await context.newPage();
    await page.goto(APP + screen.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    for (const mode of ["default"]) {
      const where = `${screen.name} @ ${vp.label}`;
      checked += 1;

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`${where}: horizontal scroll of ${overflow}px`);

      if (vp.width <= 520) {
        const small = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=tab]")) {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue;
            if (el.closest(".visually-hidden") || el.classList.contains("skip-link")) continue;
            if (el.closest("thead")) continue; // hidden on phones, replaced by the Sort by control
            const inline = style.display === "inline" && el.tagName === "A" && el.closest("p, li, span, div > p");
            if (inline) continue; // links inside a sentence are exempt
            if (r.height < 40) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 30)}" is ${Math.round(r.height)}px tall`);
          }
          return out;
        });
        for (const item of small) problems.push(`${where}: touch target ${item}`);
      }

      let result;
      for (let attempt = 1; ; attempt += 1) {
        try {
          await page.waitForLoadState("networkidle");
          await page.addScriptTag({ content: axeSource });
          result = await page.evaluate(async () =>
            window.axe.run(document),
          );
          break;
        } catch (error) {
          if (attempt >= 3) throw new Error(`${where}: ${error.message} (url ${page.url()})`);
          await page.waitForTimeout(500);
        }
      }
      for (const v of result.violations) {
        problems.push(`${where}: axe ${v.id} (${v.impact}): ${v.help}. First: ${v.nodes[0].target.join(" ")}`);
      }
    }
    await context.close();
  }
}
await browser.close();

console.log(`Checked ${checked} screen, width and mode combinations.`);
if (problems.length) {
  const unique = [...new Set(problems)];
  console.log(`\n${unique.length} problems:\n- ` + unique.join("\n- "));
  process.exitCode = 1;
} else {
  console.log("No horizontal scroll, no small touch targets, no axe violations.");
}
