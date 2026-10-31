import { validateBundle, type WildScoreBundle } from "./bundle-schema.ts";
import {
  validateRecoveryCandidateBundle,
  type RecoveryCandidateBundle,
} from "./recovery-schema.ts";
import {
  validateCorrespondenceAuditBundle,
  type CorrespondenceAuditBundle,
} from "./correspondence-audit-schema.ts";

const DEMO_BUNDLE_URL = "/demo/bundle.json";
const RECOVERY_BUNDLE_URL = "/demo/recovery-candidates.json";
const CORRESPONDENCE_AUDIT_URL = "/demo/correspondence-audit.json";

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

export async function loadCorrespondenceAuditBundle(
  signal?: AbortSignal,
): Promise<CorrespondenceAuditBundle | null> {
  const response = await fetch(CORRESPONDENCE_AUDIT_URL, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Correspondence audit is unavailable (${response.status})`);
  }
  return validateCorrespondenceAuditBundle(await response.json());
}
