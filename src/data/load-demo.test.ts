import assert from "node:assert/strict";
import test from "node:test";

import { loadCorrespondenceAuditBundle } from "./load-demo.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("treats a missing optional audit as unavailable rather than fatal", async () => {
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.equal(await loadCorrespondenceAuditBundle(), null);
});

test("loads and validates a box-only correspondence audit", async () => {
  globalThis.fetch = async (input) => {
    assert.equal(input, "/demo/correspondence-audit.json");
    return Response.json({
      schema_version: "wildscore-correspondence-audit-v1",
      clip_id: "clip-01",
      source_run_id: "run-0123456789abcdef",
      fps: 10,
      width: 100,
      height: 80,
      provenance: "generic_sam_rerun_not_merged",
      candidate_segments: [{
        segment_id: "candidate-1",
        first_frame: 1,
        last_frame: 1,
        geometry: [{ frame_index: 1, box: { left: 1, top: 2, right: 10, bottom: 20 } }],
      }],
      correspondence_candidates: [],
      reference_segments_without_candidate: [],
      candidate_segments_without_reference: ["candidate-1"],
      duplicate_review: [],
    });
  };
  const result = await loadCorrespondenceAuditBundle();
  assert.equal(result?.candidate_segments.length, 1);
});
