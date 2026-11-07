import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const luminance = (hex) => {
  const value = hex.slice(1);
  const expanded =
    value.length === 3 ? [...value].map((char) => char + char).join("") : value;
  const channels = expanded
    .match(/../g)
    .map((channel) => parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const ratio = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
const results = [];
for (const theme of ["light", "dark"]) {
  const section = css.match(
    theme === "light" ? /:root\s*{([^}]+)}/ : /\.dark\s*{([^}]+)}/,
  )[1];
  const tokens = Object.fromEntries(
    [...section.matchAll(/--([a-z-]+):\s*(#[a-f0-9]+)/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const pairs = [];
  for (const foreground of [
    "ink",
    "ink-muted",
    "accent-text",
    "success",
    "warning",
    "danger-text",
  ]) {
    for (const background of ["canvas", "surface", "surface-muted"])
      pairs.push([foreground, background, 4.5]);
  }
  pairs.push(
    ["action-ink", "action", 4.5],
    ["action-ink", "action-hover", 4.5],
  );
  for (const foreground of ["focus", "control-border"])
    for (const background of ["canvas", "surface", "surface-muted"])
      pairs.push([foreground, background, 3]);
  for (const [foreground, background, minimum] of pairs) {
    const observed = ratio(tokens[foreground], tokens[background]);
    results.push({
      theme,
      foreground,
      background,
      ratio: +observed.toFixed(2),
      minimum,
      pass: observed >= minimum,
    });
  }
}
// Fixed daylight illustration labels, independent of UI theme.
for (const [foreground, background] of [
  ["#36594e", "#dce4d9"],
  ["#244b45", "#dce4d9"],
  ["#f3eedb", "#244c4b"],
])
  results.push({
    theme: "art",
    foreground,
    background,
    ratio: +ratio(foreground, background).toFixed(2),
    minimum: 4.5,
    pass: ratio(foreground, background) >= 4.5,
  });
console.log(JSON.stringify(results, null, 2));
assert.equal(
  results.filter((result) => !result.pass).length,
  0,
  "All documented text and control pairs must meet their threshold",
);
