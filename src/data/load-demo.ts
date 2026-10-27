import { validateBundle, type WildScoreBundle } from "./bundle-schema";

const DEMO_BUNDLE_URL = "/demo/bundle.json";

export async function loadDemoBundle(
  signal?: AbortSignal,
): Promise<WildScoreBundle> {
  const response = await fetch(DEMO_BUNDLE_URL, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Saved analysis is unavailable (${response.status})`);
  }
  return validateBundle(await response.json());
}
