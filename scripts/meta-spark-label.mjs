import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.meta.ai/v1/responses";
const MODEL = "muse-spark-1.3";
const RUNS_ROOT = path.resolve("private/model-runs");
const ALLOWED_LABELS = new Set([
  "baboon",
  "warthog",
  "hippopotamus",
  "antelope",
  "unknown",
]);
const key = process.env.MODEL_API_KEY;

async function latestEvidenceDirectory() {
  const entries = (await readdir(RUNS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of entries) {
    const directory = path.join(RUNS_ROOT, name, "spark-evidence");
    try {
      if ((await stat(path.join(directory, "contact-sheet.png"))).isFile()) {
        return { name, directory };
      }
    } catch {
      // Continue until a completed evidence directory is found.
    }
  }
  throw new Error("No Spark evidence sheet was found.");
}

function extractOutputText(response) {
  const pieces = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n").trim();
}

function validateProposal(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, reason: "not_json" };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !ALLOWED_LABELS.has(parsed.label_id) ||
    typeof parsed.visible_evidence !== "string" ||
    parsed.visible_evidence.length < 1 ||
    parsed.visible_evidence.length > 300 ||
    !(
      parsed.uncertainty_reason === null ||
      (typeof parsed.uncertainty_reason === "string" &&
        parsed.uncertainty_reason.length <= 200)
    )
  ) {
    return { valid: false, reason: "schema" };
  }
  return {
    valid: true,
    proposal: {
      label_id: parsed.label_id,
      visible_evidence: parsed.visible_evidence,
      uncertainty_reason: parsed.uncertainty_reason,
    },
  };
}

async function requestProposal(imageDataUrl, panelTimes, retryReason = null) {
  const retryInstruction = retryReason
    ? ` A prior answer failed local validation (${retryReason}); return only the required JSON object.`
    : "";
  const prompt = [
    "These three panels are timestamped crops from one proposed wildlife track segment.",
    `Left, middle and right panels are at ${panelTimes.join(", ")} seconds.`,
    "Choose exactly one allowed label_id: baboon, warthog, hippopotamus, antelope, or unknown.",
    "Use only visible identifying evidence. Do not infer emotion, exact individual identity, or a match to another segment.",
    "Do not return a confidence percentage.",
    'Return JSON only: {"label_id":"unknown","visible_evidence":"short visible evidence","uncertainty_reason":"reason or null"}.',
    retryInstruction,
  ].join(" ");

  const startedAt = Date.now();
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
      max_output_tokens: 1000,
      text: {
        format: {
          type: "json_schema",
          name: "wildlife_label_proposal",
          strict: true,
          schema: {
            type: "object",
            properties: {
              label_id: {
                type: "string",
                enum: [
                  "baboon",
                  "warthog",
                  "hippopotamus",
                  "antelope",
                  "unknown",
                ],
              },
              visible_evidence: { type: "string", maxLength: 300 },
              uncertainty_reason: {
                anyOf: [
                  { type: "string", maxLength: 200 },
                  { type: "null" },
                ],
              },
            },
            required: [
              "label_id",
              "visible_evidence",
              "uncertainty_reason",
            ],
            additionalProperties: false,
          },
        },
      },
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
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
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      payload,
    };
  }
  return {
    ok: true,
    status: response.status,
    latency_ms: Date.now() - startedAt,
    payload,
  };
}

function estimateCost(usage) {
  if (!usage) return null;
  const input = Number(usage.input_tokens ?? 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  return ((input - cached) * 1.25 + cached * 0.15 + output * 4.25) / 1_000_000;
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function saveJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function main() {
  if (typeof key !== "string" || key.trim().length < 12) {
    throw new Error("MODEL_API_KEY is unavailable.");
  }
  const { name, directory } = await latestEvidenceDirectory();
  const image = await readFile(path.join(directory, "contact-sheet.png"));
  const evidence = JSON.parse(
    await readFile(path.join(directory, "evidence.json"), "utf8"),
  );
  const imageDataUrl = `data:image/png;base64,${image.toString("base64")}`;
  const panelTimes = evidence.panels.map((panel) => panel.time_seconds.toFixed(1));
  const sparkRunDirectory = path.join(directory, "spark-runs", safeTimestamp());
  await mkdir(sparkRunDirectory, { recursive: true, mode: 0o700 });
  await chmod(sparkRunDirectory, 0o700);

  let validation = { valid: false, reason: "not_run" };
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await requestProposal(
      imageDataUrl,
      panelTimes,
      attempt === 2 ? validation.reason : null,
    );
    attempts.push({
      attempt,
      ok: result.ok,
      http_status: result.status,
      latency_ms: result.latency_ms,
      response: result.payload,
    });
    if (!result.ok) break;
    if (result.payload?.status !== "completed") {
      validation = { valid: false, reason: "incomplete" };
      break;
    }
    validation = validateProposal(extractOutputText(result.payload));
    if (validation.valid) break;
  }

  const rawRecord = {
    provider: "Meta Model API",
    model: MODEL,
    data_mode: "standard model; not contributor mode",
    attempts,
  };
  await saveJson(path.join(sparkRunDirectory, "spark-raw.json"), rawRecord);

  const finalAttempt = attempts.at(-1);
  const usage = finalAttempt?.response?.usage ?? null;
  const summary = {
    status: validation.valid ? "completed" : "failed",
    source_run: name,
    provider: "Meta Model API",
    model: MODEL,
    data_mode: "standard model; not contributor mode",
    sam_object_id: evidence.sam_object_id,
    allowed_labels: [...ALLOWED_LABELS],
    attempts: attempts.length,
    latency_ms: attempts.reduce((total, attempt) => total + attempt.latency_ms, 0),
    usage,
    estimated_cost_usd_at_documented_rate: estimateCost(usage),
    validated_proposal: validation.valid ? validation.proposal : null,
    validation_failure: validation.valid ? null : validation.reason,
  };
  await saveJson(path.join(sparkRunDirectory, "spark-summary.json"), summary);
  await saveJson(path.join(directory, "spark-raw.json"), rawRecord);
  await saveJson(path.join(directory, "spark-summary.json"), summary);

  if (!validation.valid) {
    console.error("Spark did not produce a valid proposal; private diagnostics were saved.");
    process.exitCode = 1;
  } else {
    console.log("Spark returned one locally validated label proposal for human review.");
  }
}

await main();
