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
