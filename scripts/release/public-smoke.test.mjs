import test from "node:test";
import assert from "node:assert/strict";
import { smokeOrigin } from "./public-smoke-lib.mjs";
test("public smoke rejects local, credential-bearing, placeholder and non-origin URLs", () => {
  for (const value of [
    "http://public.test",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.2",
    "https://preview.example",
    "https://user:secret@host.com",
    "https://host.com?token=secret",
    "https://host.com/demo",
  ])
    assert.throws(() => smokeOrigin(value));
  assert.equal(smokeOrigin("https://github.com"), "https://github.com");
});
test("loopback harness validation is explicitly local-only", () => {
  assert.equal(
    smokeOrigin("http://127.0.0.1:3217", true),
    "http://127.0.0.1:3217",
  );
  assert.throws(() => smokeOrigin("https://github.com", true));
});

test("HTTP client uses inherited proxy separately from product authentication", async () => {
  const { inheritedApiProxy } = await import("./public-smoke-lib.mjs");
  assert.deepEqual(
    inheritedApiProxy(false, {
      HTTPS_PROXY: "http://qa-user:fixture-only@proxy.example:8080",
      NO_PROXY: "localhost,127.0.0.1",
    }),
    {
      server: "http://proxy.example:8080",
      username: "qa-user",
      password: "fixture-only",
      bypass: "localhost,127.0.0.1",
    },
  );
  assert.equal(
    inheritedApiProxy(true, { HTTPS_PROXY: "http://proxy.example:8080" }),
    undefined,
  );
  assert.equal(inheritedApiProxy(false, {}), undefined);
});
