import assert from "node:assert/strict";
import test from "node:test";

import type { WildScoreBundle } from "./bundle-schema.ts";
import { publicDemoBundle, publicRecoveryBundle } from "./public-demo.ts";
import type { RecoveryCandidateBundle } from "./recovery-schema.ts";

test("browser bundle omits internal hashes and exact run metadata", () => {
  const bundle = {
    run: {
      run_id: "2026-10-27T10-11-15-936Z",
      processed_media_sha256: "sensitive-fingerprint",
      config_hash: "internal-config-hash",
      completion_state: "completed",
      models: { segmentation: "sam-3.1" },
      provider: "Meta Model API",
    },
    label_proposals: [{ source_run_id: "internal-run" }],
    reviews: [{ reviewer: "founder", reviewed_at: "2026-10-27T12:00:00Z" }],
  } as unknown as WildScoreBundle;
  const projected = publicDemoBundle(bundle);
  const text = JSON.stringify(projected);
  assert.equal(projected.run.run_id, "hero-run-1");
  assert.doesNotMatch(text, /processed_media_sha256|config_hash|sensitive-fingerprint/u);
  assert.equal(projected.label_proposals[0].source_run_id, "label-run-1");
  assert.equal(projected.reviews[0].reviewed_at, null);
});

test("recovery projection replaces internal source runs", () => {
  const bundle = {
    candidates: [{ source_prompt: "antelope", source_run_id: "internal-sam-run" }],
    reviews: [{ reviewer: "founder", reviewed_at: "timestamp" }],
    label_proposals: [{ source_run_id: "internal-label-run" }],
    label_reviews: [{ reviewer: "founder", reviewed_at: "timestamp" }],
  } as unknown as RecoveryCandidateBundle;
  const projected = publicRecoveryBundle(bundle);
  const text = JSON.stringify(projected);
  assert.doesNotMatch(text, /internal-|founder|timestamp/u);
  assert.equal(projected.candidates[0].source_run_id, "targeted-antelope-run-1");
});
