import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Reads the real tokens so the check cannot drift from the CSS. Both themes are checked.
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const darkBlock = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="light"]'));
const lightBlock = css.slice(css.indexOf(':root[data-theme="light"]'));

function tokenIn(block, name) {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|rgba?\\([^)]*\\))`));
  return m ? m[1].trim() : null;
}

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

function theme(block) {
  // A theme block overrides only some tokens, so fall back to the default (dark) block.
  const get = (name) => {
    const value = tokenIn(block, name) ?? tokenIn(darkBlock, name);
    if (!value) throw new Error(`missing colour token ${name}`);
    return parse(value);
  };
  return get;
}

for (const [label, block] of [["dark theme", darkBlock], ["light theme", lightBlock]]) {
  const t = theme(block);
  const surfaces = Object.fromEntries(["base", "sidebar", "panel", "panel-raised"].map((n) => [n, t(n)]));
  const hoveredPanel = over(t("row-hover"), surfaces.panel);

  describe(`WCAG AA, ${label}`, () => {
    for (const [name, bg] of Object.entries({ ...surfaces, "a hovered row": hoveredPanel })) {
      it(`body and muted text on ${name} are at least 4.5:1`, () => {
        expect(ratio(t("text"), bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t("text-muted"), bg)).toBeGreaterThanOrEqual(4.5);
      });

      it(`accent links, highlight, green status and red status on ${name} are at least 4.5:1`, () => {
        for (const key of ["accent", "accent-hover", "highlight", "ok", "warning"]) {
          expect(ratio(t(key), bg), key).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    it("the active menu item, highlight on the subtle accent background, is at least 4.5:1", () => {
      expect(ratio(t("highlight"), t("accent-subtle"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("accent"), t("accent-subtle"))).toBeGreaterThanOrEqual(4.5);
    });

    it("text on the primary button is at least 4.5:1 in rest, hover and pressed states", () => {
      expect(ratio(t("text-on-accent"), t("accent"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("text-on-accent"), t("accent-hover"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("text-on-pressed"), t("accent-pressed"))).toBeGreaterThanOrEqual(4.5);
    });

    it("form field borders are at least 3:1 against every surface and the field fill", () => {
      for (const [name, bg] of Object.entries(surfaces)) expect(ratio(t("input-border"), bg), name).toBeGreaterThanOrEqual(3);
      expect(ratio(t("input-border"), t("input-fill"))).toBeGreaterThanOrEqual(3);
    });

    it("text stays readable inside a form field", () => {
      expect(ratio(t("text"), t("input-fill"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("text-muted"), t("input-fill"))).toBeGreaterThanOrEqual(4.5);
    });

    it("the focus ring is at least 3:1 against every surface and the field fill", () => {
      for (const bg of [...Object.values(surfaces), t("input-fill")]) expect(ratio(t("accent"), bg)).toBeGreaterThanOrEqual(3);
    });
  });
}

describe("dark theme layering", () => {
  it("the page, sidebar, panels and raised items step up in lightness", () => {
    const t = theme(darkBlock);
    const l = (n) => luminance(t(n));
    expect(l("base")).toBeLessThan(l("sidebar"));
    expect(l("sidebar")).toBeLessThan(l("panel"));
    expect(l("panel")).toBeLessThan(l("panel-raised"));
  });
});

describe("the specified palette", () => {
  it("uses exactly the colours that were asked for", () => {
    expect(tokenIn(darkBlock, "base")).toBe("#101114");
    expect(tokenIn(darkBlock, "panel")).toBe("#1b1b20");
    expect(tokenIn(darkBlock, "text")).toBe("#f4f4f5");
    expect(tokenIn(darkBlock, "hairline")).toBe("#303139");
    expect(tokenIn(darkBlock, "accent")).toBe("#d97736");
    expect(tokenIn(darkBlock, "accent-hover")).toBe("#e9a06f");
    expect(tokenIn(darkBlock, "accent-pressed")).toBe("#b85d26");
    expect(tokenIn(darkBlock, "accent-subtle")).toBe("#38251b");
    expect(tokenIn(lightBlock, "base")).toBe("#f7f7fa");
    expect(tokenIn(lightBlock, "panel")).toBe("#ffffff");
    expect(tokenIn(lightBlock, "text")).toBe("#18181b");
    expect(tokenIn(lightBlock, "hairline")).toBe("#e1e1e8");
    expect(tokenIn(lightBlock, "accent")).toBe("#a94716");
    expect(tokenIn(lightBlock, "accent-hover")).toBe("#87380f");
    expect(tokenIn(lightBlock, "accent-pressed")).toBe("#702d0c");
    expect(tokenIn(lightBlock, "accent-subtle")).toBe("#fbe8dc");
  });
});
