import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateRecoveryCandidateBundle } from "../src/data/recovery-schema.ts";

const INPUT = path.resolve("private/bundles/clip-01/recovery-candidates-labelled.json");
const DECISIONS = path.resolve("private/evaluation/completed-recovery-label-decisions.json");
const OUTPUT = path.resolve("private/bundles/clip-01/recovery-candidates-label-reviewed.json");

const bundle = validateRecoveryCandidateBundle(JSON.parse(await readFile(INPUT, "utf8")));
const saved = JSON.parse(await readFile(DECISIONS, "utf8"));
if (
  saved.schema !== "wildscore-private-recovery-label-review-v1" ||
  saved.clip_id !== bundle.clip_id || !Array.isArray(saved.decisions)
) throw new Error("Saved recovery label decisions are invalid.");
const proposalIds = new Set(bundle.label_proposals.map((proposal) => proposal.candidate_id));
if (
  saved.decisions.length !== proposalIds.size ||
  new Set(saved.decisions.map((decision) => decision.candidate_id)).size !== proposalIds.size ||
  saved.decisions.some((decision) => !proposalIds.has(decision.candidate_id))
) throw new Error("Saved recovery label decisions are incomplete.");
const labelReviews = saved.decisions.map((decision) => ({
  candidate_id: decision.candidate_id,
  decision: decision.decision,
  value: decision.value,
  reviewer: "local_reviewer",
  reviewed_at: saved.reviewed_at,
}));
const reviewed = validateRecoveryCandidateBundle({ ...bundle, label_reviews: labelReviews });
await writeFile(OUTPUT, `${JSON.stringify(reviewed, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT, 0o600);
console.log(`Private recovery bundle saved with ${labelReviews.length} label reviews.`);
