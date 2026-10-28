import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateBundle } from "../src/data/bundle-schema.ts";

const BASE_PATH = path.resolve("private/bundles/clip-01/bundle.json");
const DECISIONS_PATH = path.resolve("private/evaluation/completed-event-decisions.json");
const OUTPUT_PATH = path.resolve("private/bundles/clip-01/bundle-reviewed.json");

const bundle = validateBundle(JSON.parse(await readFile(BASE_PATH, "utf8")));
const recovered = JSON.parse(await readFile(DECISIONS_PATH, "utf8"));
if (
  recovered.schema !== "wildscore-private-event-review-v1" ||
  recovered.clip_id !== bundle.clip.clip_id ||
  !Array.isArray(recovered.decisions)
) {
  throw new Error("Recovered event decisions did not match the saved bundle.");
}

const eventById = new Map(bundle.events.map((event) => [event.event_id, event]));
const decisionIds = recovered.decisions.map((decision) => decision.event_id);
if (
  decisionIds.length !== bundle.events.length ||
  new Set(decisionIds).size !== decisionIds.length ||
  decisionIds.some((eventId) => !eventById.has(eventId))
) {
  throw new Error("Recovered event decisions were incomplete or contained unknown IDs.");
}

const eventReviews = recovered.decisions.map((decision) => {
  const event = eventById.get(decision.event_id);
  if (!event || !["accepted", "rejected", "uncertain"].includes(decision.decision)) {
    throw new Error("A recovered event decision was invalid.");
  }
  return {
    review_kind: "event",
    event_id: event.event_id,
    decision: decision.decision,
    original_value: event.event_kind,
    new_value: null,
    reviewer: "local_reviewer",
    reviewed_at: null,
    correction_note: "Recovered from the completed local review; original timestamp unavailable.",
  };
});

const reviewedBundle = validateBundle({
  ...bundle,
  reviews: [
    ...bundle.reviews.filter((review) => review.review_kind !== "event"),
    ...eventReviews,
  ],
});
await writeFile(OUTPUT_PATH, `${JSON.stringify(reviewedBundle, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT_PATH, 0o600);
console.log(`Private reviewed bundle saved with ${eventReviews.length} event decisions.`);
