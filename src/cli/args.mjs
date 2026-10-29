const PORT_MIN = 1024;
const PORT_MAX = 65_535;

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`--port must be an integer from ${PORT_MIN} to ${PORT_MAX}.`);
  }
  return port;
}

export function parseCliArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { mode: "help" };
  }

  const remaining = [...argv];
  const command = remaining.shift();
  if (command !== "--demo" && command !== "demo") {
    throw new Error("Use `wildscore --demo` for the keyless cached demo.");
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
