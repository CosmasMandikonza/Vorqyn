#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let failed = false;
for (const name of [
  "narration-contingency.txt",
  "narration-integrated-synthetic.txt",
]) {
  const text = readFileSync(resolve(root, "docs/release", name), "utf8");
  const words = text.trim().split(/\s+/).length;
  const estimatedSeconds = (words / 120) * 60;
  const pass =
    text.startsWith("This is VORQYN for the MLH Solana Hackathon.") &&
    estimatedSeconds <= 110;
  console.log(
    JSON.stringify({
      file: name,
      status: pass ? "PASS" : "FAIL",
      words,
      estimatedSecondsAt120Wpm: estimatedSeconds,
      actualRecordingDuration: "NOT RUN — no recorded media produced",
    }),
  );
  if (!pass) failed = true;
}
process.exitCode = failed ? 1 : 0;
