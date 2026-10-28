import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateRecoveryCandidateBundle } from "../src/data/recovery-schema.ts";

const INPUT = path.resolve("private/bundles/clip-01/recovery-candidates-reviewed.json");
const PROPOSALS_ROOT = path.resolve("private/label-review/recovery-proposals");
const OUTPUT = path.resolve("private/bundles/clip-01/recovery-candidates-labelled.json");

const bundle = validateRecoveryCandidateBundle(JSON.parse(await readFile(INPUT, "utf8")));
const latest = (await readdir(PROPOSALS_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .at(-1);
if (!latest) throw new Error("No recovery label proposal run was found.");
const run = JSON.parse(
  await readFile(path.join(PROPOSALS_ROOT, latest, "results.json"), "utf8"),
);
if (
  run.schema !== "wildscore-private-recovery-label-proposals-v1" ||
  run.clip_id !== bundle.clip_id || run.model !== "muse-spark-1.3" ||
  run.store !== false || run.context_condition !== "visible_evidence_only" ||
  !Array.isArray(run.results)
) {
  throw new Error("Recovery label proposal run is invalid.");
}
const acceptedIds = new Set(
  bundle.reviews
    .filter((review) => review.decision === "accepted")
    .map((review) => review.candidate_id),
);
const labelProposals = run.results.map((result) => {
  if (!acceptedIds.has(result.candidate_id) || !result.proposal) {
    throw new Error("Recovery label results were incomplete or targeted an unkept candidate.");
  }
  return {
    candidate_id: result.candidate_id,
    ...result.proposal,
    model: run.model,
    source_run_id: result.source_run_id,
    context_condition: run.context_condition,
  };
});
if (labelProposals.length !== acceptedIds.size) {
  throw new Error("Recovery label results did not cover every kept candidate.");
}
const labelled = validateRecoveryCandidateBundle({ ...bundle, label_proposals: labelProposals });
await writeFile(OUTPUT, `${JSON.stringify(labelled, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT, 0o600);
console.log(`Private labelled recovery bundle saved with ${labelProposals.length} proposals.`);
