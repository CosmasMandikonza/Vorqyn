#!/usr/bin/env node
/** Inspect real media locally; never creates or publishes a video. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const index = process.argv.indexOf("--file"),
  file = process.argv[index + 1];
if (index < 0 || !file || !existsSync(file)) {
  console.error(
    "BLOCKED: --file must identify an existing recording. No video is claimed.",
  );
  process.exit(2);
}
const result = spawnSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height",
    "-of",
    "json",
    file,
  ],
  { encoding: "utf8" },
);
if (result.error?.code === "ENOENT") {
  console.error("BLOCKED: ffprobe is required; install FFmpeg and retry.");
  process.exit(2);
}
if (result.status !== 0) {
  console.error("FAIL: media could not be inspected by ffprobe.");
  process.exit(1);
}
const data = JSON.parse(result.stdout),
  duration = Number(data.format?.duration),
  video = data.streams?.find((s) => s.codec_type === "video"),
  audio = data.streams?.some((s) => s.codec_type === "audio");
const pass =
  !!video &&
  audio &&
  Number.isFinite(duration) &&
  duration > 0 &&
  duration <= 120;
console.log(
  JSON.stringify(
    {
      status: pass ? "PASS" : "FAIL",
      durationSeconds: duration,
      video,
      audio,
      publicVisibility:
        "NOT RUN — founder must verify upload in signed-out browser",
      hackathonNameAtStart: "NOT RUN — founder must inspect picture and audio",
      submissionReceipt: "NOT RUN",
    },
    null,
    2,
  ),
);
process.exitCode = pass ? 0 : 1;
