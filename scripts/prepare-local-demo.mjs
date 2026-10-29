import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
const PRIVATE_MEDIA_NAME = "clip-01-sanitized-master.mp4";
const PUBLIC_MEDIA_NAME = "wildscore-field-demo.mp4";
const execFileAsync = promisify(execFile);

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const rawBundle = await readFile(PRIVATE_BUNDLE, "utf8");
const bundle = validateBundle(JSON.parse(rawBundle));
const rawRecovery = await readFile(PRIVATE_RECOVERY, "utf8");
const recovery = validateRecoveryCandidateBundle(JSON.parse(rawRecovery));
const browserBundle = validateBundle({
  ...publicDemoBundle(bundle),
  clip: { ...bundle.clip, display_media: PUBLIC_MEDIA_NAME },
});
const browserRecovery = validateRecoveryCandidateBundle(publicRecoveryBundle(recovery));
if (bundle.clip.display_media !== PRIVATE_MEDIA_NAME) {
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
const publicMedia = path.join(DEMO_DIRECTORY, PUBLIC_MEDIA_NAME);
await execFileAsync("ffmpeg", [
  "-hide_banner",
  "-loglevel", "error",
  "-y",
  "-i", PRIVATE_MEDIA,
  "-map", "0:v:0",
  "-an",
  "-vf", "scale=-2:720:flags=lanczos",
  "-r", "30",
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "21",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-map_metadata", "-1",
  "-map_chapters", "-1",
  publicMedia,
]);
await chmod(publicMedia, 0o600);

const attribution = [
  "WildScore field demo excerpt",
  "Creator: WildScore project",
  "Media licence: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)",
  "Licence: https://creativecommons.org/licenses/by-nc/4.0/",
  "",
  "This licence applies to the demo video only, not to the software or cached model outputs.",
  "The cached outputs are review proposals generated with Meta SAM 3.1 and Muse Spark 1.3; they are not ground truth.",
  "",
].join("\n");
await writeFile(path.join(DEMO_DIRECTORY, "ATTRIBUTION.txt"), attribution, { mode: 0o600 });

const assetNames = [
  "ATTRIBUTION.txt",
  "bundle.json",
  "recovery-candidates.json",
  PUBLIC_MEDIA_NAME,
];
const assets = Object.fromEntries(
  await Promise.all(assetNames.map(async (name) => [name, await sha256(path.join(DEMO_DIRECTORY, name))])),
);
const manifest = {
  schema: "wildscore-demo-manifest-v1",
  clip_id: browserBundle.clip.clip_id,
  replay_mode: "cached_saved_analysis",
  inference_required: false,
  models: ["sam-3.1", "muse-spark-1.3"],
  media: {
    creator: "WildScore project",
    licence: "CC BY-NC 4.0",
    licence_url: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
  assets,
};
await writeFile(
  path.join(DEMO_DIRECTORY, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

console.log("Prepared public, integrity-manifested demo assets in web/public/demo.");
