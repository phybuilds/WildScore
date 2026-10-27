import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SCAN_ROOTS = [path.resolve("web/public"), path.resolve("web/out")];
const PRIVATE_CONTEXT = path.resolve("private/ground-truth/clip-01-context.json");
const fixedNeedles = [
  "MODEL_API_KEY=",
  ["NEXT", "PUBLIC", "MODEL"].join("_"),
  "private/model-runs",
  "private/incoming",
  "private/derived",
  ["BUILD", "BRIEF"].join("_"),
  ["", "Users", ""].join("/"),
  "C:\\Users\\",
  process.cwd(),
];
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:sk|pat|ghp|glpat)-[A-Za-z0-9_-]{16,}\b/u,
  /["'](?:api[_-]?key|access[_-]?token|client[_-]?secret)["']\s*:\s*["'][^"']{8,}["']/iu,
];

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function filesUnder(root) {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Public output must not contain symbolic links.");
      }
      return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

function privateLocationValues(value, parentKey = "") {
  if (typeof value === "string") {
    return /country|location|park|site|region/i.test(parentKey) && value.length >= 4
      ? [value]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => privateLocationValues(item, parentKey));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      privateLocationValues(item, key),
    );
  }
  return [];
}

const privateNeedles = [];
if (await exists(PRIVATE_CONTEXT)) {
  const context = JSON.parse(await readFile(PRIVATE_CONTEXT, "utf8"));
  privateNeedles.push(...privateLocationValues(context));
}

const files = (await Promise.all(SCAN_ROOTS.map(filesUnder))).flat();
const failures = [];
for (const filePath of files) {
  const relativePath = path.relative(process.cwd(), filePath);
  if (/(^|\/)\.env(?:\.|$)/u.test(relativePath)) {
    failures.push(`${relativePath}: environment file`);
    continue;
  }
  const bytes = await readFile(filePath);
  const text = bytes.toString("utf8");
  if ([...fixedNeedles, ...privateNeedles].some((needle) => text.includes(needle))) {
    failures.push(`${relativePath}: private marker`);
  } else if (credentialPatterns.some((pattern) => pattern.test(text))) {
    failures.push(`${relativePath}: credential-like value`);
  }
}

if (failures.length > 0) {
  throw new Error(`Public-output privacy check failed:\n${failures.join("\n")}`);
}
console.log(`Public-output privacy check passed (${files.length} files scanned).`);
