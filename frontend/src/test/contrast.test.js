import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Reads the real tokens so the check cannot drift from the CSS.
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing token ${name}`);
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

// The lightest thing a surface can sit on is the lightest backdrop shape.
const backdrops = ["base", "blob-1", "blob-2", "blob-3"].map((n) => parse(token(n)));
const lightest = backdrops.reduce((a, b) => (luminance(a) > luminance(b) ? a : b));

const surfaces = {
  "glass-1": backdrops.map((b) => over(parse(token("glass-1-fill")), b)),
  "glass-2": backdrops.map((b) => over(parse(token("glass-2-fill")), b)),
  "glass-3": backdrops.map((b) => over(parse(token("glass-3-fill")), b)),
  "opaque fallback 1 and 2": [parse(token("opaque-1"))],
  "opaque fallback 3": [parse(token("opaque-3"))],
};

const text = parse(token("text"));
const muted = parse(token("text-muted"));
const accent = parse(token("accent"));
const accentHover = parse(token("accent-hover"));
const warning = parse(token("warning"));

describe("WCAG AA on every glass level", () => {
  for (const [name, list] of Object.entries(surfaces)) {
    for (const [label, fg] of [["text", text], ["muted text", muted]]) {
      it(`${label} on ${name} is at least 4.5:1`, () => {
        for (const bg of list) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const name of ["glass-2", "glass-3", "opaque fallback 1 and 2", "opaque fallback 3"]) {
    it(`accent, accent hover and warning text on ${name} are at least 4.5:1`, () => {
      for (const bg of surfaces[name]) {
        for (const fg of [accent, accentHover, warning]) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("accent links on glass-1 are at least 4.5:1", () => {
    for (const bg of surfaces["glass-1"]) expect(ratio(accent, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("text on the primary button is at least 4.5:1, also on hover", () => {
    const onAccent = parse(token("text-on-accent"));
    expect(ratio(onAccent, accent)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(onAccent, accentHover)).toBeGreaterThanOrEqual(4.5);
  });

  it("form field borders are at least 3:1 against the surface and against the field fill", () => {
    const border = parse(token("input-border"));
    const fill = parse(token("input-fill"));
    for (const name of ["glass-2", "glass-3", "opaque fallback 1 and 2"]) {
      for (const bg of surfaces[name]) {
        expect(ratio(border, bg)).toBeGreaterThanOrEqual(3);
        expect(ratio(border, over(fill, bg))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("text stays readable inside a form field", () => {
    const fill = parse(token("input-fill"));
    for (const bg of surfaces["glass-2"]) {
      expect(ratio(text, over(fill, bg))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(muted, over(fill, bg))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the focus ring is at least 3:1 against every surface", () => {
    for (const list of Object.values(surfaces)) for (const bg of list) expect(ratio(accent, bg)).toBeGreaterThanOrEqual(3);
  });

  it("the lightest backdrop shape stays close to the base hue family", () => {
    expect(luminance(lightest)).toBeLessThan(0.05);
  });
});
