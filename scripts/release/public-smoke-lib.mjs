import { isIP } from "node:net";
import { safePublicUrl } from "./lib.mjs";
export function smokeOrigin(input, localOnly = false) {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Supply an origin without credentials, path, query or fragment",
    );
  if (localOnly) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      throw new Error("--local-only permits loopback origins only");
  } else if (
    !safePublicUrl(url.origin) ||
    isIP(url.hostname) ||
    !url.hostname.includes(".") ||
    /\.(?:local|internal|test|example|localhost)$/.test(url.hostname)
  )
    throw new Error("Public smoke requires a real HTTPS DNS origin");
  return url.origin;
}
