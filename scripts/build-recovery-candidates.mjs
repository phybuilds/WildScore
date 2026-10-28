import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

import { validateRecoveryCandidateBundle } from "../src/data/recovery-schema.ts";

const EXPERIMENT_ROOT = path.resolve("private/model-experiments/sam-targeted-recall");
const AUDIT_PATH = path.resolve("private/evaluation/sam-concept-merge-audit.json");
const OUTPUT_PATH = path.resolve("private/bundles/clip-01/recovery-candidates.json");
const FPS = 15;

async function* eventsFromNdjson(filePath) {
  for (const line of (await readFile(filePath, "utf8")).split("\n")) {
    if (line.trim()) yield JSON.parse(line);
  }
}

function recordKey(record) {
  return `${record.frame?.frameIndex}:${record.objectId}`;
}

const audit = JSON.parse(await readFile(AUDIT_PATH, "utf8"));
if (audit.status !== "completed" || audit.decision !== "audit_only_no_automatic_merge") {
  throw new Error("The concept-merge audit was unavailable or unsafe.");
}

const candidates = [];
let media = null;
for (const promptAudit of audit.prompts) {
  if (!["antelope", "hippopotamus"].includes(promptAudit.prompt)) {
    throw new Error("The merge audit contained an unsupported prompt.");
  }
  const runDirectory = path.join(EXPERIMENT_ROOT, promptAudit.prompt, promptAudit.run_id);
  const summary = JSON.parse(await readFile(path.join(runDirectory, "sam-summary.json"), "utf8"));
  if (summary.status !== "completed" || summary.prompt !== promptAudit.prompt) {
    throw new Error("A targeted SAM run did not match its audit record.");
  }
  media ??= summary.parser_summary.processed_media;
  const parsed = parseVideoStream(eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")));
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed") throw new Error("A targeted SAM run was incomplete.");
  const boxes = recordsOfKind(result.records, "box");
  const masks = recordsOfKind(result.records, "mask");
  const masksByKey = new Map(masks.map((mask) => [recordKey(mask), mask]));

  for (const auditedTrack of promptAudit.tracks) {
    if (auditedTrack.classification !== "additive_candidate") continue;
    const objectId = auditedTrack.target_track_id.split(":").at(-1);
    const trackBoxes = boxes.filter((box) => String(box.objectId) === objectId);
    if (trackBoxes.length === 0) throw new Error("An audited additive track had no geometry.");
    const geometry = trackBoxes.map((box) => {
      const mask = masksByKey.get(recordKey(box));
      if (!mask) throw new Error("A targeted SAM box had no matching mask.");
      return {
        frame_index: box.frame.frameIndex,
        object_id: `${promptAudit.prompt}:${objectId}`,
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        mask: {
          encoding: mask.mask.encoding,
          width: mask.mask.width,
          height: mask.mask.height,
          payload: mask.mask.payload,
        },
        detection_confidence: box.confidence ?? null,
      };
    }).sort((left, right) => left.frame_index - right.frame_index);
    candidates.push({
      candidate_id: `recovery-${promptAudit.prompt}-${objectId}`,
      source_prompt: promptAudit.prompt,
      source_object_id: objectId,
      source_run_id: promptAudit.run_id,
      suggested_label: promptAudit.prompt,
      first_frame: geometry[0].frame_index,
      last_frame: geometry.at(-1).frame_index,
      start_s: geometry[0].frame_index / FPS,
      end_s: geometry.at(-1).frame_index / FPS,
      audit_classification: "additive_candidate",
      uncertainty_flags: [
        "cross_response_identity_unresolved",
        "appearance_may_be_tracker_start",
        ...(promptAudit.prompt === "hippopotamus"
          ? ["possible_same_animal_track_handoff", "known_incomplete_species_recall"]
          : []),
      ],
      geometry,
    });
  }
}

if (!media || media.fps !== FPS) throw new Error("Targeted candidate media was inconsistent.");
const bundle = validateRecoveryCandidateBundle({
  schema: "wildscore-recovery-candidates-v1",
  clip_id: "clip-01",
  processed_fps: media.fps,
  processed_frame_count: media.frame_count,
  width: media.width,
  height: media.height,
  candidates: candidates.sort((left, right) =>
    left.start_s - right.start_s || left.candidate_id.localeCompare(right.candidate_id),
  ),
  reviews: [],
    label_proposals: [],
    label_reviews: [],
  limitations: [
    "Candidates are prompt-specific tracks, not confirmed cross-response identities.",
    "Keeping a candidate does not confirm an entry, exit, species label, or individual identity.",
    "The hippopotamus pass did not detect both visible hippos simultaneously.",
  ],
});
await writeFile(OUTPUT_PATH, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT_PATH, 0o600);
console.log(`Private recovery bundle saved with ${bundle.candidates.length} additive candidates.`);
