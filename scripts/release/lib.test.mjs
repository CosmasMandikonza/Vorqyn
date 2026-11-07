import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregate,
  inspectCredentials,
  pngSize,
  safePublicUrl,
} from "./lib.mjs";
test("blocked and unrun checks never aggregate to pass", () => {
  assert.equal(
    aggregate([{ status: "PASS" }, { status: "BLOCKED" }]),
    "BLOCKED",
  );
  assert.equal(aggregate([{ status: "NOT RUN" }]), "BLOCKED");
  assert.equal(aggregate([]), "BLOCKED");
  assert.equal(aggregate([{ status: "BLOCKED" }, { status: "FAIL" }]), "FAIL");
});
test("public URLs reject secrets, query tokens, examples and local servers", () => {
  for (const url of [
    "http://localhost:3100",
    "https://x:y@host.test",
    "https://host.test?token=x",
    "https://demo.example",
  ])
    assert.equal(safePublicUrl(url), false);
  assert.equal(
    safePublicUrl("https://github.com/CosmasMandikonza/Vorqyn"),
    true,
  );
});
test("credential scan identifies a test environment file without returning its value", () => {
  const dir = mkdtempSync(join(tmpdir(), "vorqyn-scan-"));
  writeFileSync(join(dir, ".env"), "TOKEN=synthetic-test-only");
  const result = inspectCredentials(dir);
  assert.equal(result.length, 1);
  assert.equal(JSON.stringify(result).includes("synthetic-test-only"), false);
});
test("PNG signature and dimensions are checked rather than filename assumptions", () => {
  const dir = mkdtempSync(join(tmpdir(), "vorqyn-png-"));
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(1329, 16);
  bytes.writeUInt32BE(558, 20);
  const p = join(dir, "claimed-1440.png");
  writeFileSync(p, bytes);
  assert.deepEqual(pngSize(p), { width: 1329, height: 558 });
  writeFileSync(p, bytes.subarray(0, 24));
  assert.throws(() => pngSize(p), /IHDR/);
  bytes.write("IDAT", 12);
  writeFileSync(p, bytes);
  assert.throws(() => pngSize(p), /IHDR/);
});
test("insecure environment configuration is flagged without secret values", async () => {
  const { environmentFindings } = await import("./lib.mjs");
  const results = environmentFindings({
    NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta",
    NEXT_PUBLIC_SOLANA_RPC_URL: "https://user:synthetic-test@host.test",
  });
  assert.equal(results.length, 2);
  assert.equal(JSON.stringify(results).includes("synthetic-test"), false);
  assert.deepEqual(
    environmentFindings({
      NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://api.devnet.solana.com",
    }),
    [],
  );
});
