import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeSparkLabelStage, META_SPARK_URL, validateSparkProposal } from "./spark-label-stage.mjs";

const runId = "run-0123456789abcdef";

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "wildscore-spark-"));
  const runDir = path.join(repositoryRoot, "private", "runs", runId);
  await mkdir(path.join(runDir, "events"), { recursive: true });
  await writeFile(path.join(runDir, "run.json"), JSON.stringify({
    runId,
    derivative: { fps: 15, width: 100, height: 80 },
  }));
  await writeFile(path.join(runDir, "events", "result.json"), JSON.stringify({
    runId,
    segments: [{
      segment_id: "seg-1-1",
      geometry: [0, 1, 2].map((frame_index) => ({ frame_index, box: { left: 1, top: 1, right: 2, bottom: 2 } })),
    }],
  }));
  return { repositoryRoot };
}

test("validates bounded snake-case proposals", () => {
  assert.deepEqual(validateSparkProposal('{"label_id":"olive_baboon","visible_evidence":"Long muzzle.","uncertainty_reason":null}'), {
    label_id: "olive_baboon", visible_evidence: "Long muzzle.", uncertainty_reason: null,
  });
  assert.equal(validateSparkProposal('{"label_id":"Olive baboon","visible_evidence":"x","uncertainty_reason":null}'), null);
});

test("labels selected tracks without sending location or user hints", async () => {
  const { repositoryRoot } = await fixture();
  const calls = [];
  const result = await executeSparkLabelStage({
    repositoryRoot, runId, apiKey: "private-key", maxCalls: 1,
    buildEvidence: async () => Buffer.from("image"),
    request: async (options) => {
      calls.push(options);
      return { ok: true, status: 200, payload: {
        status: "completed",
        output: [{ content: [{ type: "output_text", text: '{"label_id":"baboon","visible_evidence":"Primate muzzle.","uncertainty_reason":null}' }] }],
      } };
    },
  });
  assert.equal(result.checkpoint.labelProposals[0].label_id, "baboon");
  assert.equal(calls[0].apiKey, "private-key");
  assert.equal(result.checkpoint.promptContext, "visible_evidence_only_no_location_or_filename");
  assert.equal(META_SPARK_URL, "https://api.meta.ai/v1/responses");
});

test("keeps a failed label call as a private non-fatal result", async () => {
  const { repositoryRoot } = await fixture();
  const result = await executeSparkLabelStage({
    repositoryRoot, runId, apiKey: "private-key", maxCalls: 1,
    buildEvidence: async () => Buffer.from("image"),
    request: async () => ({ ok: false, status: 429, payload: null }),
  });
  assert.equal(result.checkpoint.labelProposals.length, 0);
  assert.deepEqual(result.checkpoint.attempts, [{ segment_id: "seg-1-1", status: 429, valid: false }]);
});
