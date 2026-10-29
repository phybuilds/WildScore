export type SavedAnalysisReplayPhase = "idle" | "running" | "complete";

export function replayProgress(
  currentTimeS: number,
  durationS: number,
  phase: SavedAnalysisReplayPhase,
): number {
  if (phase === "complete") return 1;
  if (phase === "idle" || !Number.isFinite(durationS) || durationS <= 0) return 0;
  if (!Number.isFinite(currentTimeS)) return 0;
  return Math.min(1, Math.max(0, currentTimeS / durationS));
}

export function isReplayEvidenceVisible(
  evidenceTimeS: number,
  currentTimeS: number,
  phase: SavedAnalysisReplayPhase,
): boolean {
  if (phase !== "running") return phase === "complete";
  return evidenceTimeS <= currentTimeS + Number.EPSILON;
}
