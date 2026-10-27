import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateBundle } from "../src/data/bundle-schema.ts";

const PRIVATE_BUNDLE = path.resolve("private/bundles/clip-01/bundle.json");
const PRIVATE_MEDIA = path.resolve(
  "private/derived/clip-01-sanitized-master.mp4",
);
const DEMO_DIRECTORY = path.resolve("web/public/demo");
const EXPECTED_MEDIA_NAME = "clip-01-sanitized-master.mp4";

const rawBundle = await readFile(PRIVATE_BUNDLE, "utf8");
const bundle = validateBundle(JSON.parse(rawBundle));
if (bundle.clip.display_media !== EXPECTED_MEDIA_NAME) {
  throw new Error("The bundle references an unexpected display-media name.");
}

await mkdir(DEMO_DIRECTORY, { recursive: true, mode: 0o700 });
await chmod(DEMO_DIRECTORY, 0o700);
await writeFile(path.join(DEMO_DIRECTORY, "bundle.json"), rawBundle, {
  mode: 0o600,
});
await copyFile(PRIVATE_MEDIA, path.join(DEMO_DIRECTORY, EXPECTED_MEDIA_NAME));
await chmod(path.join(DEMO_DIRECTORY, EXPECTED_MEDIA_NAME), 0o600);

console.log("Prepared ignored local demo assets in web/public/demo.");
