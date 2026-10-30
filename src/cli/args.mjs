const PORT_MIN = 1024;
const PORT_MAX = 65_535;

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`--port must be an integer from ${PORT_MIN} to ${PORT_MAX}.`);
  }
  return port;
}

function parseMaxCalls(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 16) {
    throw new Error("--max-calls must be an integer from 1 to 16.");
  }
  return count;
}

export function parseCliArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { mode: "help" };
  }

  const remaining = [...argv];
  const command = remaining.shift();
  if (command === "recover") {
    const batchPath = remaining.shift();
    if (!batchPath || batchPath.startsWith("-")) {
      throw new Error("recover requires a missing-animal batch JSON path.");
    }
    let dryRun = false;
    let maxCalls = 8;
    while (remaining.length > 0) {
      const argument = remaining.shift();
      if (argument === "--dry-run") dryRun = true;
      else if (argument === "--max-calls") {
        const value = remaining.shift();
        if (value === undefined) throw new Error("--max-calls requires a value.");
        maxCalls = parseMaxCalls(value);
      } else if (argument?.startsWith("--max-calls=")) {
        maxCalls = parseMaxCalls(argument.slice("--max-calls=".length));
      } else throw new Error(`Unknown recover option: ${argument}`);
    }
    if (!dryRun) {
      throw new Error("Live recovery is not enabled yet; use --dry-run to validate the batch.");
    }
    return { mode: "recover", batchPath, dryRun, maxCalls };
  }
  if (command !== "--demo" && command !== "demo") {
    throw new Error("Use `wildscore --demo` or `wildscore recover <batch.json> --dry-run`.");
  }

  let checkOnly = false;
  let port = 4173;
  while (remaining.length > 0) {
    const argument = remaining.shift();
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
