import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const STATUSES = ["PASS", "FAIL", "BLOCKED", "NOT RUN"];
export function aggregate(checks) {
  if (!checks.length) return "BLOCKED";
  if (checks.some((c) => c.status === "FAIL")) return "FAIL";
  if (checks.some((c) => c.status === "BLOCKED" || c.status === "NOT RUN"))
    return "BLOCKED";
  return "PASS";
}
export function safePublicUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.hostname.endsWith(".example")
    );
  } catch {
    return false;
  }
}
export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function filesUnder(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
export function inspectCredentials(root, names = []) {
  const findings = [];
  for (const name of names)
    if (/^NEXT_PUBLIC_.*(?:PRIVATE|SECRET|PASSWORD|MNEMONIC|SEED)/i.test(name))
      findings.push({
        path: "process environment",
        kind: "public secret variable name",
        name,
      });
  for (const path of filesUnder(root)) {
    if (/(?:^|[\\/])(?:node_modules|\.next|\.git)(?:[\\/]|$)/.test(path))
      continue;
    const relative = path.slice(root.length + 1);
    if (
      /(?:^|[\\/])\.env(?:\.[^\\/]*)?$/.test(relative) &&
      !/\.(?:example|sample|template)$/.test(relative)
    )
      findings.push({
        path: relative,
        kind: "tracked non-example environment file",
      });
    if (
      statSync(path).size > 2 * 1024 * 1024 ||
      /\.(?:png|jpg|glb|woff2?|ico|zip|mp4|webm)$/.test(path)
    )
      continue;
    const text = readFileSync(path, "utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
      findings.push({ path: relative, kind: "private key block" });
    if (
      /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/.test(
        text,
      )
    )
      findings.push({ path: relative, kind: "credential-shaped token" });
    if (/(?:keypair|wallet).*\.json$/i.test(relative)) {
      try {
        const data = JSON.parse(text);
        if (
          Array.isArray(data) &&
          data.length === 64 &&
          data.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
        )
          findings.push({ path: relative, kind: "64-byte wallet keypair" });
      } catch {
        /* not a keypair JSON */
      }
    }
  }
  return findings;
}
export function pngSize(path) {
  const b = readFileSync(path);
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Invalid PNG signature");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
