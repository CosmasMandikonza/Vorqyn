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

/** Playwright's Node HTTP client does not inherit the shell proxy automatically. */
export function inheritedApiProxy(localOnly = false, env = process.env) {
  if (localOnly) return undefined;
  const raw =
    env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!raw) return undefined;
  let proxy;
  try {
    proxy = new URL(raw);
  } catch {
    throw new Error(
      "Invalid inherited API proxy configuration; values omitted",
    );
  }
  if (!["http:", "https:"].includes(proxy.protocol))
    throw new Error("Unsupported inherited API proxy protocol; values omitted");
  return {
    server: proxy.origin,
    ...(proxy.username ? { username: decodeURIComponent(proxy.username) } : {}),
    ...(proxy.password ? { password: decodeURIComponent(proxy.password) } : {}),
    ...((env.NO_PROXY ?? env.no_proxy)
      ? { bypass: env.NO_PROXY ?? env.no_proxy }
      : {}),
  };
}
