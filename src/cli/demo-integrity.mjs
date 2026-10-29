import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function validateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Demo manifest must be an object.");
  }
  if (value.schema !== "wildscore-demo-manifest-v1") {
    throw new Error("Unsupported demo manifest schema.");
  }
  if (!value.assets || typeof value.assets !== "object" || Array.isArray(value.assets)) {
    throw new Error("Demo manifest assets are missing.");
  }
  const entries = Object.entries(value.assets);
  if (entries.length === 0 || entries.length > 20) {
    throw new Error("Demo manifest has an invalid asset count.");
  }
  for (const [name, digest] of entries) {
    if (!SAFE_ASSET_NAME.test(name) || !SHA256.test(digest)) {
      throw new Error(`Demo manifest contains an invalid asset entry: ${name}`);
    }
  }
  return value;
}

export async function verifyDemoAssets(demoDirectory) {
  const manifestPath = path.join(demoDirectory, "manifest.json");
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  for (const [name, expectedDigest] of Object.entries(manifest.assets)) {
    const assetPath = path.join(demoDirectory, name);
    const details = await stat(assetPath);
    if (!details.isFile()) throw new Error(`Demo asset is not a regular file: ${name}`);
    const actualDigest = createHash("sha256").update(await readFile(assetPath)).digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new Error(`Demo asset failed integrity verification: ${name}`);
    }
  }
  return manifest;
}
