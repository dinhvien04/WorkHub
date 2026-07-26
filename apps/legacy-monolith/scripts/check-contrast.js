"use strict";

/**
 * WCAG contrast gate for the design tokens.
 *
 * A bold, colourful palette is easy to get wrong: the shades that look best in
 * a mockup are frequently the ones that fail on text. This script asserts the
 * ratios instead of trusting the eye, so a future palette tweak that breaks
 * accessibility fails the build rather than shipping.
 *
 * Usage: node scripts/check-contrast.js
 *        npm run check:contrast
 *
 * Thresholds (WCAG 2.1):
 *   AA  normal text  4.5:1
 *   AA  large text   3.0:1   (>=24px, or >=18.66px bold)
 *   AA  UI component 3.0:1   (borders, focus rings, icons)
 */
const fs = require("fs");
const path = require("path");

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseDeclarations(block) {
  const tokens = {};
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let match;
  while ((match = re.exec(block))) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

/**
 * Read the two themes out of the stylesheet, so the checks run against what
 * actually ships rather than a copy that can drift.
 *
 * The dark theme only overrides a handful of tokens, so it is merged over the
 * light one — which is exactly how the cascade resolves it in the browser, and
 * catches pairs that pass in light mode but fail in dark.
 */
function readThemes() {
  const cssPath = path.join(__dirname, "..", "public", "css", "style.css");
  const css = fs.readFileSync(cssPath, "utf8");

  const rootStart = css.indexOf(":root");
  if (rootStart === -1) throw new Error("No :root block found in style.css");
  const rootBlock = css.slice(rootStart, css.indexOf("}", rootStart));
  const light = parseDeclarations(rootBlock);

  const darkMatch = css.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/,
  );
  const dark = darkMatch
    ? { ...light, ...parseDeclarations(darkMatch[1]) }
    : null;

  return { light, dark };
}

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
const AA_UI = 3.0;

/**
 * Each entry: [foreground token, background token, minimum ratio, description]
 */
const CHECKS = [
  // Body and surface text
  ["--color-text", "--color-bg", AA_NORMAL, "body text on page background"],
  ["--color-text", "--color-surface", AA_NORMAL, "body text on cards"],
  ["--color-muted", "--color-bg", AA_NORMAL, "muted text on page background"],
  ["--color-muted", "--color-surface", AA_NORMAL, "muted text on cards"],

  // Brand text
  ["--color-primary-text", "--color-surface", AA_NORMAL, "brand text on cards"],
  ["--color-primary-text", "--color-bg", AA_NORMAL, "brand text on page background"],

  // Text on filled brand surfaces
  ["--color-on-primary", "--color-primary-fill", AA_NORMAL, "label on primary button"],
  ["--color-on-primary", "--color-primary-fill-hover", AA_NORMAL, "label on primary button (hover)"],
  ["--color-on-accent", "--color-accent", AA_NORMAL, "label on accent button"],
  ["--color-on-danger", "--color-danger", AA_NORMAL, "label on danger button"],

  // Status text on its own tinted background
  ["--color-success-text", "--color-success-bg", AA_NORMAL, "success text on success tint"],
  ["--color-warning-text", "--color-warning-bg", AA_NORMAL, "warning text on warning tint"],
  ["--color-danger-text", "--color-danger-bg", AA_NORMAL, "danger text on danger tint"],
  ["--color-info-text", "--color-info-bg", AA_NORMAL, "info text on info tint"],

  // Dark surfaces
  ["--color-on-dark", "--color-dark-surface", AA_NORMAL, "text on dark surface"],
  ["--color-on-dark-muted", "--color-dark-surface", AA_NORMAL, "muted text on dark surface"],

  // Non-text contrast
  ["--color-border-strong", "--color-surface", AA_UI, "input border on cards"],
  ["--color-focus", "--color-surface", AA_UI, "focus ring on cards"],
  ["--color-focus", "--color-bg", AA_UI, "focus ring on page background"],
  ["--color-primary", "--color-surface", AA_UI, "primary as a UI accent on cards"],

  // Large display text
  ["--color-primary-text", "--color-primary-50", AA_LARGE, "headline on brand tint"],
];

function runTheme(name, tokens) {
  const failures = [];
  const rows = [];

  for (const [fgToken, bgToken, minimum, description] of CHECKS) {
    const fg = tokens[fgToken];
    const bg = tokens[bgToken];

    if (!fg || !bg) {
      failures.push(
        `MISSING  [${name}] ${description}: ${!fg ? fgToken : bgToken} is not defined`,
      );
      continue;
    }

    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= minimum;
    if (!pass) {
      failures.push(
        `FAIL     [${name}] ${description}: ${fgToken} (${fg}) on ${bgToken} (${bg}) ` +
          `= ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
      );
    }
    rows.push(
      `  ${pass ? "ok  " : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${minimum})  ${description}`,
    );
  }

  console.log(`\n${name} theme\n`);
  console.log(rows.join("\n"));
  return failures;
}

function main() {
  const { light, dark } = readThemes();

  console.log("WCAG contrast check");
  const failures = runTheme("Light", light);
  if (dark) failures.push(...runTheme("Dark", dark));

  if (failures.length > 0) {
    console.error(`\n${failures.length} contrast failure(s):\n`);
    failures.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }

  const total = CHECKS.length * (dark ? 2 : 1);
  console.log(`\nAll ${total} contrast pairs pass WCAG AA.`);
}

main();

module.exports = { contrastRatio, relativeLuminance };
