const PORT_MIN = 1024;
const PORT_MAX = 65_535;
const MAX_CALLS_MIN = 1;
const MAX_CALLS_MAX = 16;
const MAX_SECONDS_MIN = 1;
const MAX_SECONDS_MAX = 120;
const DEFAULT_MAX_CALLS_ANALYSE = 8;
const DEFAULT_MAX_SECONDS_ANALYSE = 30;

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`--port must be an integer from ${PORT_MIN} to ${PORT_MAX}.`);
  }
  return port;
}

function parseMaxCalls(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < MAX_CALLS_MIN || count > MAX_CALLS_MAX) {
    throw new Error(`--max-calls must be an integer from ${MAX_CALLS_MIN} to ${MAX_CALLS_MAX}.`);
  }
  return count;
}

function parseMaxSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MAX_SECONDS_MIN || seconds > MAX_SECONDS_MAX) {
    throw new Error(`--max-seconds must be an integer from ${MAX_SECONDS_MIN} to ${MAX_SECONDS_MAX}.`);
  }
  return seconds;
}

function rejectApiKeyOption(argument) {
  if (typeof argument === "string" && argument.startsWith("-") && /api.?key/iu.test(argument)) {
    throw new Error("API keys must never be passed as command-line options.");
  }
}

function parseValueOption(remaining, flag, parse) {
  const value = remaining.shift();
  if (value === undefined) throw new Error(`${flag} requires a value.`);
  return parse(value);
}

export function parseCliArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { mode: "help" };
  }

  const remaining = [...argv];
  const command = remaining.shift();
  if (command === "view") {
    const runId = remaining.shift();
    if (!runId || !/^run-[0-9a-f]{16}$/u.test(runId)) {
      throw new Error("view requires a run ID in the form run-<16 lowercase hex characters>.");
    }
    let port = 4173;
    while (remaining.length > 0) {
      const argument = remaining.shift();
      rejectApiKeyOption(argument);
      if (argument === "--port") {
        port = parseValueOption(remaining, "--port", parsePort);
      } else if (argument?.startsWith("--port=")) {
        port = parsePort(argument.slice("--port=".length));
      } else throw new Error(`Unknown view option: ${argument}`);
    }
    return { mode: "view", runId, port };
  }
  if (command === "recover") {
    const batchPath = remaining.shift();
    if (!batchPath || batchPath.startsWith("-")) {
      throw new Error("recover requires a missing-animal batch JSON path.");
    }
    let dryRun = false;
    let maxCalls = 8;
    while (remaining.length > 0) {
      const argument = remaining.shift();
      rejectApiKeyOption(argument);
      if (argument === "--dry-run") dryRun = true;
      else if (argument === "--max-calls") {
        maxCalls = parseValueOption(remaining, "--max-calls", parseMaxCalls);
      } else if (argument?.startsWith("--max-calls=")) {
        maxCalls = parseMaxCalls(argument.slice("--max-calls=".length));
      } else throw new Error(`Unknown recover option: ${argument}`);
    }
    if (!dryRun) {
      throw new Error("Live recovery is not enabled yet; use --dry-run to validate the batch.");
    }
    return { mode: "recover", batchPath, dryRun, maxCalls };
  }
  if (command === "doctor") {
    while (remaining.length > 0) {
      const argument = remaining.shift();
      rejectApiKeyOption(argument);
      throw new Error(`Unknown doctor option: ${argument}`);
    }
    return { mode: "doctor" };
  }
  if (command === "analyse") {
    const videoPath = remaining.shift();
    if (!videoPath || videoPath.startsWith("-")) {
      throw new Error("analyse requires a local video file path.");
    }
    let dryRun = false;
    let prepareOnly = false;
    let samOnly = false;
    let full = false;
    let yes = false;
    let maxSeconds = DEFAULT_MAX_SECONDS_ANALYSE;
    let maxCalls = DEFAULT_MAX_CALLS_ANALYSE;
    let maxCallsProvided = false;
    while (remaining.length > 0) {
      const argument = remaining.shift();
      rejectApiKeyOption(argument);
      if (argument === "--dry-run") dryRun = true;
      else if (argument === "--prepare-only") prepareOnly = true;
      else if (argument === "--sam-only") samOnly = true;
      else if (argument === "--full") full = true;
      else if (argument === "--yes") yes = true;
      else if (argument === "--max-seconds") {
        maxSeconds = parseValueOption(remaining, "--max-seconds", parseMaxSeconds);
      } else if (argument?.startsWith("--max-seconds=")) {
        maxSeconds = parseMaxSeconds(argument.slice("--max-seconds=".length));
      } else if (argument === "--max-calls") {
        maxCalls = parseValueOption(remaining, "--max-calls", parseMaxCalls);
        maxCallsProvided = true;
      } else if (argument?.startsWith("--max-calls=")) {
        maxCalls = parseMaxCalls(argument.slice("--max-calls=".length));
        maxCallsProvided = true;
      } else throw new Error(`Unknown analyse option: ${argument}`);
    }
    if ([dryRun, prepareOnly, samOnly, full].filter(Boolean).length > 1) {
      throw new Error("--dry-run, --prepare-only, --sam-only, and --full are mutually exclusive.");
    }
    if (yes && !samOnly && !full) {
      throw new Error("--yes is accepted only with --sam-only or --full.");
    }
    if (samOnly && !yes) {
      throw new Error("Live SAM analysis requires --yes after reviewing the dry-run plan.");
    }
    if (samOnly && maxCallsProvided && maxCalls > 3) {
      throw new Error("SAM-only --max-calls must be an integer from 1 to 3.");
    }
    if (samOnly && !maxCallsProvided) maxCalls = 3;
    if (full && !yes) {
      throw new Error("Full live analysis requires --yes after reviewing the dry-run plan.");
    }
    if (full && maxCalls < 4) {
      throw new Error("Full live analysis requires --max-calls from 4 to 16.");
    }
    if (!dryRun && !prepareOnly && !samOnly && !full) {
      throw new Error("Choose --dry-run, --prepare-only, --sam-only --yes, or --full --yes.");
    }
    return {
      mode: "analyse",
      videoPath,
      dryRun,
      prepareOnly,
      samOnly,
      full,
      yes,
      maxSeconds,
      maxCalls,
    };
  }
  if (command !== "--demo" && command !== "demo") {
    throw new Error(
      "Use `wildscore --demo`, `wildscore doctor`, `wildscore analyse <video> --dry-run`, `wildscore view <run-id>`, or `wildscore recover <batch.json> --dry-run`.",
    );
  }

  let checkOnly = false;
  let port = 4173;
  while (remaining.length > 0) {
    const argument = remaining.shift();
    rejectApiKeyOption(argument);
    if (argument === "--check") {
      checkOnly = true;
    } else if (argument === "--port") {
      const value = remaining.shift();
      if (value === undefined) throw new Error("--port requires a value.");
      port = parsePort(value);
    } else if (argument?.startsWith("--port=")) {
      port = parsePort(argument.slice("--port=".length));
    } else {
      throw new Error(`Unknown demo option: ${argument}`);
    }
  }

  return { mode: "demo", checkOnly, port };
}
