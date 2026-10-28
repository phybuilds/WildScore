import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.meta.ai/v1/responses";
const MODEL = "muse-spark-1.3";
const EVIDENCE_ROOT = path.resolve("private/label-review/recovery-evidence");
const OUTPUT_ROOT = path.resolve("private/label-review/recovery-proposals");
const ALLOWED_LABELS = new Set([
  "baboon",
  "warthog",
  "hippopotamus",
  "antelope",
  "unknown",
]);
const key = process.env.MODEL_API_KEY;

function extractOutputText(response) {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .filter((text) => typeof text === "string")
    .join("\n")
    .trim();
}

function validateProposal(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { valid: false, reason: "not_json" };
  }
  if (
    !value ||
    typeof value !== "object" ||
    !ALLOWED_LABELS.has(value.label_id) ||
    typeof value.visible_evidence !== "string" ||
    value.visible_evidence.length < 1 ||
    value.visible_evidence.length > 300 ||
    !(
      value.uncertainty_reason === null ||
      (typeof value.uncertainty_reason === "string" &&
        value.uncertainty_reason.length <= 200)
    )
  ) {
    return { valid: false, reason: "schema" };
  }
  return { valid: true, proposal: value };
}

async function requestProposal(imageUrl, panelTimes, retryReason = null) {
  const retry = retryReason
    ? ` A prior answer failed local validation (${retryReason}); return only valid JSON.`
    : "";
  const prompt = [
    "These three timestamped crops show one proposed wildlife track.",
    `Panels occur at ${panelTimes.join(", ")} seconds.`,
    "Choose exactly one broad label_id: baboon, warthog, hippopotamus, antelope, or unknown.",
    "Use only visible morphology. Nearby animals may appear; label the animal consistently centred across panels.",
    "Do not infer location, exact species, identity, entry, exit, or confidence percentage.",
    'Return JSON only: {"label_id":"unknown","visible_evidence":"short visible evidence","uncertainty_reason":"reason or null"}.',
    retry,
  ].join(" ");
  const started = Date.now();
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort: "minimal" },
      max_output_tokens: 800,
      text: {
        format: {
          type: "json_schema",
          name: "recovery_wildlife_label_proposal",
          strict: true,
          schema: {
            type: "object",
            properties: {
              label_id: { type: "string", enum: [...ALLOWED_LABELS] },
              visible_evidence: { type: "string", maxLength: 300 },
              uncertainty_reason: {
                anyOf: [
                  { type: "string", maxLength: 200 },
                  { type: "null" },
                ],
              },
            },
            required: ["label_id", "visible_evidence", "uncertainty_reason"],
            additionalProperties: false,
          },
        },
      },
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageUrl },
        ],
      }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { error: { message: "Non-JSON response body." } };
  }
  return {
    ok: response.ok,
    status: response.status,
    latency_ms: Date.now() - started,
    payload,
  };
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function main() {
  if (typeof key !== "string" || key.trim().length < 12) {
    throw new Error("MODEL_API_KEY is unavailable.");
  }
  const queue = JSON.parse(
    await readFile(path.join(EVIDENCE_ROOT, "queue.json"), "utf8"),
  );
  if (queue.model_policy !== "Meta models only") {
    throw new Error("Recovery label queue does not enforce the Meta-only policy.");
  }
  const directory = path.join(OUTPUT_ROOT, timestamp());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const results = [];

  for (const item of queue.items) {
    const evidenceDirectory = path.join(path.resolve("private"), item.evidence_directory);
    const evidence = JSON.parse(
      await readFile(path.join(evidenceDirectory, "evidence.json"), "utf8"),
    );
    const image = await readFile(path.join(evidenceDirectory, "contact-sheet.png"));
    const imageUrl = `data:image/png;base64,${image.toString("base64")}`;
    let validation = { valid: false, reason: "not_run" };
    const attempts = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await requestProposal(
        imageUrl,
        evidence.panels.map((panel) => panel.time_seconds.toFixed(1)),
        attempt === 2 ? validation.reason : null,
      );
      const outputText = response.ok ? extractOutputText(response.payload) : "";
      validation = response.ok
        ? validateProposal(outputText)
        : { valid: false, reason: `http_${response.status}` };
      attempts.push({
        attempt,
        http_status: response.status,
        latency_ms: response.latency_ms,
        validation: validation.valid ? "valid" : validation.reason,
      });
      if (validation.valid) break;
    }
    results.push({
      candidate_id: item.candidate_id,
      model: MODEL,
      source_run_id: path.basename(directory),
      proposal: validation.valid ? validation.proposal : null,
      attempts,
    });
    console.log(`${item.candidate_id}: ${validation.valid ? validation.proposal.label_id : "failed"}`);
  }

  await writePrivateJson(path.join(directory, "results.json"), {
    schema: "wildscore-private-recovery-label-proposals-v1",
    clip_id: queue.clip_id,
    model: MODEL,
    store: false,
    context_condition: "visible_evidence_only",
    results,
  });
  const failed = results.filter((result) => result.proposal === null).length;
  console.log(`Validated ${results.length - failed} of ${results.length} Meta label proposals.`);
  if (failed > 0) process.exitCode = 1;
}

await main();
