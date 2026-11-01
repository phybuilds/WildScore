import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateBundle } from "../data/bundle-schema.ts";
import { validateRecoveryCandidateBundle } from "../data/recovery-schema.ts";
import { buildPrivateRunBundle } from "./run-bundle-stage.mjs";

const runId = "run-0123456789abcdef";

test("builds a private geometry-only bundle and empty recovery layer", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "wildscore-bundle-"));
  const runDir = path.join(repositoryRoot, "private", "runs", runId);
  await mkdir(path.join(runDir, "sam"), { recursive: true });
  await mkdir(path.join(runDir, "events"), { recursive: true });
  await writeFile(path.join(runDir, "analysis.mp4"), "sanitised-video");
  await writeFile(path.join(runDir, "run.json"), JSON.stringify({
    runId,
    derivative: { fps: 15, width: 100, height: 80, durationSeconds: 1 },
  }));
  await writeFile(path.join(runDir, "sam", "result.json"), JSON.stringify({
    runId,
    summary: { processed_media: { frame_count: 15 } },
  }));
  await writeFile(path.join(runDir, "events", "result.json"), JSON.stringify({
    runId,
    schemaVersion: 1,
    segments: [{
      segment_id: "seg-1-1",
      sam_object_id: "1",
      first_frame: 0,
      last_frame: 1,
      start_s: 0,
      end_s: 1 / 15,
      already_visible_at_start: true,
      still_visible_at_end: false,
      geometry: [{
        frame_index: 0,
        object_id: "1",
        box: { left: 1, top: 1, right: 2, bottom: 2 },
        mask: { encoding: "one_bit", width: 1, height: 1, payload: "AA==" },
        detection_confidence: null,
      }],
    }],
    events: [],
  }));

  const result = await buildPrivateRunBundle({ repositoryRoot, runId });
  assert.equal(validateBundle(result.bundle).run.completion_state, "geometry_only");
  assert.equal(validateRecoveryCandidateBundle(result.recovery).candidates.length, 0);
  assert.equal((await stat(path.join(result.outputDir, "bundle.json"))).mode & 0o777, 0o600);
  assert.equal(await readFile(path.join(result.outputDir, "analysis.mp4"), "utf8"), "sanitised-video");
});

test("rejects a label proposal for an unknown segment", async () => {
  await assert.rejects(
    buildPrivateRunBundle({
      repositoryRoot: "/nonexistent",
      runId: "unsafe",
      labelProposals: [{ segment_id: "missing" }],
    }),
    /invalid run ID/u,
  );
});
