import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "./args.mjs";

test("parses keyless demo options", () => {
  assert.deepEqual(parseCliArgs(["--demo"]), {
    mode: "demo",
    checkOnly: false,
    port: 4173,
  });
  assert.deepEqual(parseCliArgs(["demo", "--check", "--port=5000"]), {
    mode: "demo",
    checkOnly: true,
    port: 5000,
  });
});

test("rejects unknown commands and unsafe ports", () => {
  assert.throws(() => parseCliArgs(["analyse"]), /local video file path/u);
  assert.throws(() => parseCliArgs(["--demo", "--port=80"]), /1024/u);
  assert.throws(() => parseCliArgs(["--demo", "--wat"]), /Unknown/u);
});

test("parses doctor with no options", () => {
  assert.deepEqual(parseCliArgs(["doctor"]), { mode: "doctor" });
  assert.throws(() => parseCliArgs(["doctor", "--check"]), /Unknown doctor option/u);
});

test("parses a private run viewer without accepting arbitrary paths", () => {
  assert.deepEqual(parseCliArgs(["view", "run-0123456789abcdef", "--port=5001"]), {
    mode: "view",
    runId: "run-0123456789abcdef",
    port: 5001,
  });
  assert.throws(() => parseCliArgs(["view", "../private"]), /requires a run ID/u);
  assert.throws(
    () => parseCliArgs(["view", "run-0123456789abcdef", "--api-key=x"]),
    /never/u,
  );
});

test("parses analyse dry-run preflight options", () => {
  assert.deepEqual(parseCliArgs(["analyse", "clip.mp4", "--dry-run"]), {
    mode: "analyse",
    videoPath: "clip.mp4",
    dryRun: true,
    prepareOnly: false,
    samOnly: false,
    full: false,
    yes: false,
    maxSeconds: 30,
    maxCalls: 8,
  });
  assert.deepEqual(
    parseCliArgs(["analyse", "clip.mp4", "--dry-run", "--max-seconds=60", "--max-calls=4"]),
    {
      mode: "analyse",
      videoPath: "clip.mp4",
      dryRun: true,
      prepareOnly: false,
      samOnly: false,
      full: false,
      yes: false,
      maxSeconds: 60,
      maxCalls: 4,
    },
  );
  assert.deepEqual(parseCliArgs(["analyse", "clip.mp4", "--prepare-only"]), {
    mode: "analyse",
    videoPath: "clip.mp4",
    dryRun: false,
    prepareOnly: true,
    samOnly: false,
    full: false,
    yes: false,
    maxSeconds: 30,
    maxCalls: 8,
  });
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--dry-run", "--prepare-only"]),
    /mutually exclusive/u,
  );
  assert.throws(() => parseCliArgs(["analyse", "clip.mp4"]), /Choose/u);
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--dry-run", "--max-seconds=121"]),
    /1 to 120/u,
  );
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--dry-run", "--max-calls=17"]),
    /1 to 16/u,
  );
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--dry-run", "--api-key=x"]),
    /never/u,
  );
});

test("requires an explicit confirmation for the bounded live SAM stage", () => {
  assert.deepEqual(
    parseCliArgs([
      "analyse",
      "clip.mp4",
      "--sam-only",
      "--yes",
      "--max-seconds=20",
      "--max-calls=2",
    ]),
    {
      mode: "analyse",
      videoPath: "clip.mp4",
      dryRun: false,
      prepareOnly: false,
      samOnly: true,
      full: false,
      yes: true,
      maxSeconds: 20,
      maxCalls: 2,
    },
  );
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--sam-only"]),
    /requires --yes/u,
  );
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--yes"]),
    /only with --sam-only/u,
  );
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--dry-run", "--sam-only", "--yes"]),
    /mutually exclusive/u,
  );
  assert.equal(
    parseCliArgs(["analyse", "clip.mp4", "--sam-only", "--yes"]).maxCalls,
    3,
  );
  assert.throws(
    () =>
      parseCliArgs([
        "analyse",
        "clip.mp4",
        "--sam-only",
        "--yes",
        "--max-calls=4",
      ]),
    /1 to 3/u,
  );
});

test("requires explicit confirmation and a total call budget for full analysis", () => {
  assert.deepEqual(
    parseCliArgs(["analyse", "clip.mp4", "--full", "--yes", "--max-calls=8"]),
    {
      mode: "analyse", videoPath: "clip.mp4", dryRun: false,
      prepareOnly: false, samOnly: false, full: true, yes: true,
      maxSeconds: 30, maxCalls: 8,
    },
  );
  assert.throws(() => parseCliArgs(["analyse", "clip.mp4", "--full"]), /requires --yes/u);
  assert.throws(
    () => parseCliArgs(["analyse", "clip.mp4", "--full", "--yes", "--max-calls=3"]),
    /4 to 16/u,
  );
});

test("parses bounded recovery preflight options", () => {
  assert.deepEqual(
    parseCliArgs(["recover", "reports.json", "--dry-run", "--max-calls=4"]),
    { mode: "recover", batchPath: "reports.json", dryRun: true, maxCalls: 4 },
  );
  assert.throws(() => parseCliArgs(["recover", "reports.json"]), /not enabled/u);
  assert.throws(
    () => parseCliArgs(["recover", "reports.json", "--dry-run", "--max-calls=17"]),
    /1 to 16/u,
  );
});
