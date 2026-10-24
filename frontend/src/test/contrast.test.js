import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Reads the real tokens so the check cannot drift from the CSS.
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|rgba?\\([^)]*\\))`));
  if (!m) throw new Error(`missing colour token ${name}`);
  return m[1].trim();
};

function parse(value) {
  if (value.startsWith("#")) {
    const n = parseInt(value.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const [r, g, b, a = 1] = value.match(/[\d.]+/g).map(Number);
  return { r, g, b, a };
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const surfaces = Object.fromEntries(["base", "sidebar", "panel", "panel-raised"].map((n) => [n, parse(token(n))]));
const c = Object.fromEntries(
  ["text", "text-muted", "accent", "accent-hover", "gold", "ok", "warning", "text-on-accent", "input-border", "input-fill"].map((n) => [n, parse(token(n))]),
);
// Hovered rows are a faint white wash over a panel.
const hoveredPanel = over(parse(token("row-hover")), surfaces.panel);

describe("WCAG AA on every surface", () => {
  for (const [name, bg] of Object.entries({ ...surfaces, "a hovered row": hoveredPanel })) {
    it(`body text and muted text on ${name} are at least 4.5:1`, () => {
      expect(ratio(c.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c["text-muted"], bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`mint links, gold highlights, the green status and the clay warning on ${name} are at least 4.5:1`, () => {
      for (const key of ["accent", "accent-hover", "gold", "ok", "warning"]) {
        expect(ratio(c[key], bg), key).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("text on the primary button is at least 4.5:1, also on hover", () => {
    expect(ratio(c["text-on-accent"], c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c["text-on-accent"], c["accent-hover"])).toBeGreaterThanOrEqual(4.5);
  });

  it("form field borders are at least 3:1 against the surface and the field fill", () => {
    for (const name of ["base", "sidebar", "panel", "panel-raised"]) {
      expect(ratio(c["input-border"], surfaces[name]), name).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(c["input-border"], c["input-fill"])).toBeGreaterThanOrEqual(3);
  });

  it("text stays readable inside a form field", () => {
    expect(ratio(c.text, c["input-fill"])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c["text-muted"], c["input-fill"])).toBeGreaterThanOrEqual(4.5);
  });

  it("the focus ring is at least 3:1 against every surface and the field fill", () => {
    for (const bg of [...Object.values(surfaces), c["input-fill"]]) expect(ratio(c.accent, bg)).toBeGreaterThanOrEqual(3);
  });

  it("the page, sidebar and panels step up in lightness so each reads as a layer", () => {
    const l = (n) => luminance(surfaces[n]);
    expect(l("base")).toBeLessThan(l("sidebar"));
    expect(l("sidebar")).toBeLessThan(l("panel"));
    expect(l("panel")).toBeLessThan(l("panel-raised"));
  });
});
