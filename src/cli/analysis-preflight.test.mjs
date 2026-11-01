import assert from "node:assert/strict";
import test from "node:test";

import { runAnalysisPreflight } from "./analysis-preflight.mjs";

function fakeFs(overrides = {}) {
  return {
    lstat: async () => ({ isSymbolicLink: () => false }),
    stat: async () => ({ isFile: () => true }),
    realpath: async (p) => p,
    ...overrides,
  };
}

function probeStdout(overrides = {}) {
  return JSON.stringify({
    format: { format_name: "mov,mp4,m4a", duration: "12.5" },
    streams: [
      {
        codec_type: "video",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30/1",
        duration: "12.5",
      },
    ],
    ...overrides,
  });
}

function fakeRunner(overrides = {}, capture = {}) {
  return async (tool, args, opts) => {
    capture.tool = tool;
    capture.args = args;
    capture.opts = opts;
    return { status: 0, stdout: probeStdout(overrides) };
  };
}

async function runOk(overrides = {}, fsOverrides = {}, capture = {}) {
  const lines = [];
  const code = await runAnalysisPreflight({
    videoPath: "clips/heron.mp4",
    maxSeconds: 30,
    maxCalls: 8,
    fs: fakeFs({
      realpath: async (p) => (p === "clips/heron.mp4" ? "/work/clips/heron.mp4" : "/work/clips"),
      ...fsOverrides,
    }),
    runner: fakeRunner(overrides, capture),
    log: (line) => lines.push(line),
  });
  return { code, lines, capture };
}

test("successful preflight prints basename plan and no-key statement", async () => {
  const { code, lines, capture } = await runOk();
  assert.equal(code, 0);
  assert.equal(capture.tool, "ffprobe");
  assert.ok(Array.isArray(capture.args));
  assert.equal(capture.args.includes("clips/heron.mp4"), true);
  assert.ok(!("shell" in (capture.opts ?? {})));
  assert.equal(capture.opts.timeout, 10_000);
  const text = lines.join("\n");
  assert.ok(text.includes("heron.mp4"));
  assert.ok(text.includes("sam-3.1"));
  assert.ok(text.includes("muse-spark-1.3"));
  assert.ok(text.includes("No API key was loaded and no model call was made."));
  assert.equal(text.includes("/work/clips/heron.mp4"), false);
});

test("rejects URLs, symlinks, directories, and parent escapes", async () => {
  const lines = [];
  const log = (line) => lines.push(line);
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "huge.mp4",
        fs: fakeFs({
          stat: async () => ({ isFile: () => true, size: 500 * 1024 * 1024 + 1 }),
        }),
        runner: fakeRunner(),
        log,
      }),
    /500 MiB/u,
  );
  await assert.rejects(
    () => runAnalysisPreflight({ videoPath: "https://example.com/a.mp4", fs: fakeFs(), runner: fakeRunner(), log }),
    /local file|URL/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        fs: fakeFs({ lstat: async () => ({ isSymbolicLink: () => true }) }),
        runner: fakeRunner(),
        log,
      }),
    /symlink/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "somedir",
        fs: fakeFs({ stat: async () => ({ isFile: () => false }) }),
        runner: fakeRunner(),
        log,
      }),
    /regular file|directory/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clips/heron.mp4",
        fs: fakeFs({
          realpath: async (p) => (p === "clips/heron.mp4" ? "/elsewhere/evil.mp4" : "/work/clips"),
        }),
        runner: fakeRunner(),
        log,
      }),
    /real parent/iu,
  );
});

test("enforces stream, metadata, and bound requirements", async () => {
  const lines = [];
  const log = (line) => lines.push(line);
  const baseFs = fakeFs({
    realpath: async (p) => (p === "clip.mp4" ? "/w/clip.mp4" : "/w"),
  });
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        fs: baseFs,
        runner: async () => ({
          status: 0,
          stdout: probeStdout({
            streams: [
              { codec_type: "video", width: 640, height: 480, avg_frame_rate: "30/1" },
              { codec_type: "video", width: 640, height: 480, avg_frame_rate: "30/1" },
            ],
          }),
        }),
        log,
      }),
    /exactly one video stream/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        fs: baseFs,
        runner: async () => ({ status: 0, stdout: probeStdout({ format: { format_name: "hls" } }) }),
        log,
      }),
    /playlist|network/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        maxSeconds: 30,
        fs: baseFs,
        runner: fakeRunner({ format: { format_name: "mp4", duration: "90" } }),
        log,
      }),
    /exceeds.*max-seconds|duration/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        fs: baseFs,
        runner: fakeRunner({
          streams: [{ codec_type: "video", width: 4096, height: 2160, avg_frame_rate: "30/1" }],
        }),
        log,
      }),
    /dimensions/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        fs: baseFs,
        runner: fakeRunner({
          streams: [{ codec_type: "video", width: 640, height: 480, avg_frame_rate: "120/1" }],
        }),
        log,
      }),
    /frame rate/iu,
  );
  await assert.rejects(
    () =>
      runAnalysisPreflight({
        videoPath: "clip.mp4",
        fs: baseFs,
        runner: async () => ({ status: 1, stdout: "" }),
        log,
      }),
    /ffprobe/iu,
  );
});
