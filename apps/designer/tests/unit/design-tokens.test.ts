import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const tokensCss = fs.readFileSync(path.join(src, "design-tokens.css"), "utf8");
const stylesCss = fs.readFileSync(path.join(src, "styles.css"), "utf8");

function block(css: string, selector: RegExp): Record<string, string> {
  const start = css.search(selector);
  if (start < 0) return {};
  const open = css.indexOf("{", css.indexOf(":root", start));
  const close = css.indexOf("}", open);
  return Object.fromEntries([...css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const light = block(tokensCss, /:root\s*\{/);
const dark = { ...light, ...block(tokensCss, /:root\[data-ui-theme="dark"\]/) };

function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const fn = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  throw new Error(`Cannot read colour ${value}`);
}
function luminance(value: string): number {
  const [r, g, b] = rgb(value).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe("design tokens", () => {
  it("keep colours out of styles.css: features use tokens", () => {
    const raw = stylesCss.split("\n").map((line, i) => [i + 1, line] as const).filter(([, line]) => /#[0-9a-f]{3,8}\b/i.test(line));
    expect(raw.map(([n, line]) => `${n}: ${line.trim()}`)).toEqual([]);
  });

  it("use only defined custom properties", () => {
    // The canvas sets the grid spacing inline at runtime.
    const runtime = ["--grid-major", "--grid-minor"];
    const defined = new Set([...[...`${tokensCss}\n${stylesCss}`.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]), ...runtime]);
    const used = new Set([...stylesCss.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("give every themed surface and status tone a dark-mode value", () => {
    const themed = ["--bg", "--panel", "--panel-2", "--border", "--border-strong", "--text", "--muted", "--accent", "--accent-soft", "--canvas",
      "--ok-soft", "--ok-text", "--warn-soft", "--warn-softer", "--warn-text", "--danger-soft", "--danger-line", "--danger-text", "--translucent-panel",
      "--chrome", "--on-chrome", "--on-chrome-muted", "--chrome-hover", "--chrome-sunken", "--chrome-border"];
    const overridden = block(tokensCss, /:root\[data-ui-theme="dark"\]/);
    expect(themed.filter((name) => !(name in overridden))).toEqual([]);
    // Paper is printed output and must stay white in dark mode.
    expect(Object.keys(overridden).filter((name) => name.startsWith("--paper"))).toEqual([]);
  });

  it.each([["light", light], ["dark", dark]] as const)("meet WCAG AA contrast for text in %s mode", (_mode, t) => {
    const pairs: [string, string][] = [
      ["--text", "--bg"], ["--text", "--panel"], ["--text", "--panel-2"], ["--muted", "--panel"], ["--muted", "--bg"],
      ["--ok-text", "--ok-soft"], ["--warn-text", "--warn-soft"], ["--warn-text", "--warn-softer"], ["--danger-text", "--danger-soft"],
      ["--accent", "--panel"],
      // Title bar and ribbon tabs: text on the chrome band, and the Publish button's chrome text on its light fill.
      ["--on-chrome", "--chrome"], ["--on-chrome-muted", "--chrome"],
    ];
    const failing = pairs.map(([fg, bg]) => [fg, bg, contrast(t[fg]!, t[bg]!)] as const).filter(([, , ratio]) => ratio < 4.5);
    expect(failing).toEqual([]);
    expect(contrast(t["--on-accent"]!, t["--accent"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--paper-muted"]!, t["--paper"]!)).toBeGreaterThanOrEqual(4.5);
    const strong = ["--danger", "--ok", "--warn-strong", "--overlay-snap", "--overlay-handle", "--overlay-flow-break-label"]
      .map((fill) => [fill, contrast(t["--on-strong"]!, t[fill]!)] as const).filter(([, ratio]) => ratio < 4.5);
    expect(strong).toEqual([]);
  });
});
