import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateBundle } from "../src/data/bundle-schema.ts";
import { validateRecoveryCandidateBundle } from "../src/data/recovery-schema.ts";
import { publicDemoBundle, publicRecoveryBundle } from "../src/data/public-demo.ts";

const PRIVATE_BUNDLE = path.resolve("private/bundles/clip-01/bundle-reviewed.json");
const PRIVATE_RECOVERY = path.resolve(
  "private/bundles/clip-01/recovery-candidates-label-reviewed.json",
);
const PRIVATE_MEDIA = path.resolve(
  "private/derived/clip-01-sanitized-master.mp4",
);
const DEMO_DIRECTORY = path.resolve("web/public/demo");
const EXPECTED_MEDIA_NAME = "clip-01-sanitized-master.mp4";

const rawBundle = await readFile(PRIVATE_BUNDLE, "utf8");
const bundle = validateBundle(JSON.parse(rawBundle));
const rawRecovery = await readFile(PRIVATE_RECOVERY, "utf8");
const recovery = validateRecoveryCandidateBundle(JSON.parse(rawRecovery));
const browserBundle = validateBundle(publicDemoBundle(bundle));
const browserRecovery = validateRecoveryCandidateBundle(publicRecoveryBundle(recovery));
if (bundle.clip.display_media !== EXPECTED_MEDIA_NAME) {
  throw new Error("The bundle references an unexpected display-media name.");
}
if (
  recovery.clip_id !== bundle.clip.clip_id || recovery.width !== bundle.clip.width ||
  recovery.height !== bundle.clip.height
) {
  throw new Error("Recovery candidates did not match the saved clip.");
}

await mkdir(DEMO_DIRECTORY, { recursive: true, mode: 0o700 });
await chmod(DEMO_DIRECTORY, 0o700);
await writeFile(path.join(DEMO_DIRECTORY, "bundle.json"), `${JSON.stringify(browserBundle, null, 2)}\n`, {
  mode: 0o600,
});
await writeFile(path.join(DEMO_DIRECTORY, "recovery-candidates.json"), `${JSON.stringify(browserRecovery, null, 2)}\n`, {
  mode: 0o600,
});
await copyFile(PRIVATE_MEDIA, path.join(DEMO_DIRECTORY, EXPECTED_MEDIA_NAME));
await chmod(path.join(DEMO_DIRECTORY, EXPECTED_MEDIA_NAME), 0o600);

console.log("Prepared ignored local demo assets in web/public/demo.");
