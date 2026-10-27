import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.meta.ai/v1/responses";
const MODEL = "muse-spark-1.3";
const RUNS_ROOT = path.resolve("private/model-runs");
const CONTEXT_PATH = path.resolve(
  "private/ground-truth/clip-01-context.json",
);
const LABELS = [
  "olive_baboon",
  "yellow_baboon",
  "chacma_baboon",
  "hamadryas_baboon",
  "guinea_baboon",
  "kinda_baboon",
  "baboon_unspecified",
  "unknown",
];
const key = process.env.MODEL_API_KEY;

function safeTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

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
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function validateProposal(response) {
  if (response.status !== "completed") {
    return { valid: false, reason: "incomplete" };
  }
  let parsed;
  try {
    parsed = JSON.parse(extractOutputText(response));
  } catch {
    return { valid: false, reason: "not_json" };
  }
  if (
    !LABELS.includes(parsed.label_id) ||
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

function estimateCost(usage) {
  if (!usage) return null;
  const input = Number(usage.input_tokens ?? 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  return ((input - cached) * 1.25 + cached * 0.15 + output * 4.25) / 1_000_000;
}

async function runCondition({ condition, context, imageDataUrl, panelTimes }) {
  const contextSentence = context
    ? `Country-level ecological context supplied by the reviewer: ${context}.`
    : "No geographic context is available; use only the visible pixels.";
  const prompt = [
    "These three panels come from one gap-free proposed baboon track segment.",
    `Panel times are ${panelTimes.join(", ")} seconds.`,
    contextSentence,
    `Choose exactly one label_id from: ${LABELS.join(", ")}.`,
    "Use visible morphology first. Geographic context may narrow plausible species but is not proof.",
    "Choose baboon_unspecified or unknown when the pixels do not support a finer identification.",
    "Do not infer an individual identity or return confidence percentages.",
  ].join(" ");

  const startedAt = Date.now();
  const httpResponse = await fetch(API_URL, {
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
          name: "baboon_species_proposal",
          strict: true,
          schema: {
            type: "object",
            properties: {
              label_id: { type: "string", enum: LABELS },
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
  const body = await httpResponse.text();
  let response;
  try {
    response = JSON.parse(body);
  } catch {
    response = { error: { message: "Non-JSON response body." } };
  }
  const validation = httpResponse.ok
    ? validateProposal(response)
    : { valid: false, reason: "http_error" };
  return {
    condition,
    context_supplied: context ?? null,
    http_status: httpResponse.status,
    latency_ms: Date.now() - startedAt,
    usage: response.usage ?? null,
    estimated_cost_usd_at_documented_rate: estimateCost(response.usage),
    validation,
    raw_response: response,
  };
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
  const privateContext = JSON.parse(await readFile(CONTEXT_PATH, "utf8"));
  if (
    typeof privateContext.country !== "string" ||
    privateContext.country.trim().length === 0
  ) {
    throw new Error("Private country context is missing.");
  }
  const imageDataUrl = `data:image/png;base64,${image.toString("base64")}`;
  const panelTimes = evidence.panels.map((panel) => panel.time_seconds.toFixed(1));
  const experimentDirectory = path.join(
    directory,
    "context-experiments",
    safeTimestamp(),
  );
  await mkdir(experimentDirectory, { recursive: true, mode: 0o700 });
  await chmod(experimentDirectory, 0o700);

  const blind = await runCondition({
    condition: "pixels_only",
    context: null,
    imageDataUrl,
    panelTimes,
  });
  const country = await runCondition({
    condition: "country_context",
    context: privateContext.country,
    imageDataUrl,
    panelTimes,
  });

  const raw = {
    source_run: name,
    provider: "Meta Model API",
    model: MODEL,
    data_mode: "standard model; not contributor mode",
    conditions: [blind, country],
  };
  await saveJson(path.join(experimentDirectory, "raw.json"), raw);
  const summary = {
    source_run: name,
    provider: raw.provider,
    model: MODEL,
    data_mode: raw.data_mode,
    human_reviewed_label: "olive_baboon",
    exact_location_sent: false,
    conditions: raw.conditions.map((condition) => ({
      condition: condition.condition,
      context_supplied: condition.context_supplied,
      http_status: condition.http_status,
      latency_ms: condition.latency_ms,
      usage: condition.usage,
      estimated_cost_usd_at_documented_rate:
        condition.estimated_cost_usd_at_documented_rate,
      validation: condition.validation,
    })),
  };
  await saveJson(path.join(experimentDirectory, "summary.json"), summary);

  if (summary.conditions.every((condition) => condition.validation.valid)) {
    console.log("Spark country-context A/B completed with two validated proposals.");
  } else {
    console.error("At least one Spark context condition failed validation.");
    process.exitCode = 1;
  }
}

await main();
