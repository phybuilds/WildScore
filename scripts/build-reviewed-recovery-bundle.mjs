import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateRecoveryCandidateBundle } from "../src/data/recovery-schema.ts";

const BASE_PATH = path.resolve("private/bundles/clip-01/recovery-candidates.json");
const DECISIONS_PATH = path.resolve("private/evaluation/completed-recovery-decisions.json");
const OUTPUT_PATH = path.resolve("private/bundles/clip-01/recovery-candidates-reviewed.json");

const bundle = validateRecoveryCandidateBundle(JSON.parse(await readFile(BASE_PATH, "utf8")));
const recovered = JSON.parse(await readFile(DECISIONS_PATH, "utf8"));
if (
  recovered.schema !== "wildscore-private-recovery-review-v1" ||
  recovered.clip_id !== bundle.clip_id || !Array.isArray(recovered.decisions)
) {
  throw new Error("Recovered candidate decisions did not match the candidate bundle.");
}
const candidateIds = new Set(bundle.candidates.map((candidate) => candidate.candidate_id));
const decisionIds = recovered.decisions.map((decision) => decision.candidate_id);
if (
  decisionIds.length !== bundle.candidates.length ||
  new Set(decisionIds).size !== decisionIds.length ||
  decisionIds.some((candidateId) => !candidateIds.has(candidateId))
) {
  throw new Error("Recovered candidate decisions were incomplete or contained unknown IDs.");
}
const reviews = recovered.decisions.map((decision) => {
  if (!["accepted", "rejected", "uncertain"].includes(decision.decision)) {
    throw new Error("A recovered candidate decision was invalid.");
  }
  return {
    candidate_id: decision.candidate_id,
    decision: decision.decision,
    reviewer: "local_reviewer",
    reviewed_at: null,
    correction_note: "Recovered from the completed local review; original timestamp unavailable.",
  };
});
const reviewed = validateRecoveryCandidateBundle({ ...bundle, reviews });
await writeFile(OUTPUT_PATH, `${JSON.stringify(reviewed, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT_PATH, 0o600);
const kept = reviews.filter((review) => review.decision === "accepted").length;
console.log(`Private reviewed recovery bundle saved: ${kept} kept of ${reviews.length}.`);
