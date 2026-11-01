import assert from "node:assert/strict";
import test from "node:test";

import {
  checkNodeVersion,
  collectDoctorReport,
  getToolVersionLine,
  hasModelApiKey,
  runDoctor,
  satisfiesNodeRange,
} from "./doctor.mjs";

test("node range check honours declared engines", () => {
  assert.equal(satisfiesNodeRange("v20.1.0", ">=20"), true);
  assert.equal(checkNodeVersion("v20.1.0", ">=20").ok, true);
  assert.equal(checkNodeVersion("v18.0.0", ">=20").ok, false);
  assert.equal(checkNodeVersion("v20.1.0", "").ok, false);
});

test("key presence never exposes the value", () => {
  assert.equal(hasModelApiKey({ MODEL_API_KEY: "secret-value" }), true);
  assert.equal(hasModelApiKey({}), false);
  assert.equal(hasModelApiKey({ MODEL_API_KEY: "" }), false);
});

test("tool version lines are bounded and timeout-guarded", () => {
  const calls = [];
  const runner = (tool, args, opts) => {
    calls.push([tool, args, opts]);
    return { status: 0, stdout: "ffmpeg version 7.0\nextra\n" };
  };
  const found = getToolVersionLine("ffmpeg", runner);
  assert.deepEqual(found, { ok: true, line: "ffmpeg version 7.0" });
  assert.equal(calls[0][1].includes("-version"), true);
  assert.equal(calls[0][2].timeout, 10_000);
  assert.ok(!("shell" in (calls[0][2] ?? {})));
  assert.deepEqual(getToolVersionLine("ffprobe", () => ({ status: 1, stdout: "" })), {
    ok: false,
    line: null,
  });
});

test("missing key is a warning while missing tools fail", () => {
  const okReport = collectDoctorReport({
    nodeCheck: { ok: true, message: "node ok" },
    ffmpeg: { ok: true, line: "ffmpeg version 7.0" },
    ffprobe: { ok: true, line: "ffprobe version 7.0" },
    keyPresent: false,
  });
  assert.equal(okReport.ok, true);
  assert.ok(okReport.lines.join("\n").includes("warning"));
  const badReport = collectDoctorReport({
    nodeCheck: { ok: true, message: "node ok" },
    ffmpeg: { ok: false, line: null },
    ffprobe: { ok: true, line: "ffprobe version 7.0" },
    keyPresent: true,
  });
  assert.equal(badReport.ok, false);
});

test("runDoctor uses fakes and never logs the key value", async () => {
  const lines = [];
  const runner = (tool) => ({ status: 0, stdout: `${tool} version 7.0\n` });
  const code = await runDoctor({
    packageJsonPath: "/nonexistent/package.json",
    env: { MODEL_API_KEY: "super-secret-value" },
    runner,
    log: (line) => lines.push(line),
  });
  assert.equal(typeof code, "number");
  assert.equal(lines.join("\n").includes("super-secret-value"), false);
});
