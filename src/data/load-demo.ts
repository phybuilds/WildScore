import { validateBundle, type WildScoreBundle } from "./bundle-schema";
import {
  validateRecoveryCandidateBundle,
  type RecoveryCandidateBundle,
} from "./recovery-schema";

const DEMO_BUNDLE_URL = "/demo/bundle.json";
const RECOVERY_BUNDLE_URL = "/demo/recovery-candidates.json";

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

export async function loadRecoveryCandidateBundle(
  signal?: AbortSignal,
): Promise<RecoveryCandidateBundle> {
  const response = await fetch(RECOVERY_BUNDLE_URL, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Recovery candidates are unavailable (${response.status})`);
  }
  return validateRecoveryCandidateBundle(await response.json());
}
