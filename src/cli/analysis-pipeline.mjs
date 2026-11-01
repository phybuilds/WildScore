import { executeMetaSamRun } from "./meta-sam-run.mjs";
import { prepareAnalysisRun } from "./run-preparation.mjs";
import { executeSamEventStage } from "./sam-event-stage.mjs";
import { buildPrivateRunBundle } from "./run-bundle-stage.mjs";
import { executeSparkLabelStage } from "./spark-label-stage.mjs";

export async function executeSamEventPipeline(options = {}) {
  const {
    videoPath,
    maxSeconds,
    maxCalls,
    repositoryRoot,
    apiKey,
    prepare = prepareAnalysisRun,
    runSam = executeMetaSamRun,
    deriveEvents = executeSamEventStage,
    buildBundle = buildPrivateRunBundle,
  } = options;

  const prepared = await prepare({ videoPath, maxSeconds, repositoryRoot });
  const sam = await runSam({
    repositoryRoot,
    runId: prepared.runId,
    apiKey,
    maxAttempts: Math.min(maxCalls, 3),
  });
  const events = await deriveEvents({
    repositoryRoot,
    runId: prepared.runId,
  });
  const bundle = await buildBundle({
    repositoryRoot,
    runId: prepared.runId,
  });

  return { prepared, sam, events, bundle };
}

export async function executeFullAnalysisPipeline(options = {}) {
  const {
    videoPath,
    maxSeconds,
    maxCalls,
    repositoryRoot,
    apiKey,
    prepare = prepareAnalysisRun,
    runSam = executeMetaSamRun,
    deriveEvents = executeSamEventStage,
    labelTracks = executeSparkLabelStage,
    buildBundle = buildPrivateRunBundle,
  } = options;
  if (!Number.isInteger(maxCalls) || maxCalls < 4 || maxCalls > 16) {
    throw new Error("Full analysis requires maxCalls from 4 to 16.");
  }
  const prepared = await prepare({ videoPath, maxSeconds, repositoryRoot });
  const sam = await runSam({
    repositoryRoot,
    runId: prepared.runId,
    apiKey,
    maxAttempts: 3,
  });
  const events = await deriveEvents({ repositoryRoot, runId: prepared.runId });
  const spark = await labelTracks({
    repositoryRoot,
    runId: prepared.runId,
    apiKey,
    maxCalls: maxCalls - 3,
  });
  const bundle = await buildBundle({
    repositoryRoot,
    runId: prepared.runId,
    labelProposals: spark.checkpoint.labelProposals,
  });
  return { prepared, sam, events, spark, bundle };
}
