import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { parseAndSummariseSamEvents } from "../../scripts/lib/sam-output.mjs";
import { deleteMetaFile, uploadMetaVideo } from "./meta-file-client.mjs";
import { META_SAM_CONCEPT, META_SAM_MODEL, runMetaSam } from "./meta-sam-client.mjs";
import { withMetaRetry } from "./meta-retry-policy.mjs";
import { RUN_ID_PATTERN } from "./run-preparation.mjs";

export const META_SAM_RUN_SCHEMA_VERSION = 1;

const defaultFs = {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
};

export class MetaSamRunError extends Error {
  constructor(stage, source = null) {
    super(`SAM stage failed during ${stage}.`);
    this.name = "MetaSamRunError";
    this.stage = stage;
    this.status = Number.isInteger(source?.status) ? source.status : null;
    this.type =
      typeof source?.type === "string" && /^[a-z0-9_]{1,64}$/u.test(source.type)
        ? source.type
        : null;
    this.code =
      typeof source?.code === "string" && /^[a-z0-9_]{1,64}$/u.test(source.code)
        ? source.code
        : null;
    this.retryAfter =
      typeof source?.retryAfter === "string" && source.retryAfter.length <= 256
        ? source.retryAfter
        : null;
    this.isTimeout = source?.isTimeout === true;
    this.isConnectionError = source?.isConnectionError === true;
  }
}

async function removeOwnedFile(fsPromises, filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function hashFile(filePath, openStream = createReadStream) {
  const digest = createHash("sha256");
  const stream = openStream(filePath);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

function validateManifest(manifest, runId) {
  if (
    manifest?.runId !== runId ||
    manifest?.schemaVersion !== 1 ||
    manifest?.stages?.preparation !== "completed" ||
    manifest?.derivative?.fps !== 15 ||
    !Number.isInteger(manifest?.derivative?.width) ||
    !Number.isInteger(manifest?.derivative?.height) ||
    !Number.isFinite(manifest?.derivative?.durationSeconds) ||
    !/^[0-9a-f]{64}$/u.test(manifest?.derivative?.sha256 ?? "")
  ) {
    throw new MetaSamRunError("validation");
  }
}

function validateCheckpoint(checkpoint, manifest) {
  return (
    checkpoint?.schemaVersion === META_SAM_RUN_SCHEMA_VERSION &&
    checkpoint?.runId === manifest.runId &&
    checkpoint?.model === META_SAM_MODEL &&
    checkpoint?.prompt === META_SAM_CONCEPT &&
    checkpoint?.derivativeSha256 === manifest.derivative.sha256 &&
    /^[0-9a-f]{64}$/u.test(checkpoint?.rawEventsSha256 ?? "") &&
    checkpoint?.summary !== null &&
    typeof checkpoint?.summary === "object" &&
    checkpoint?.usage !== null &&
    typeof checkpoint?.usage === "object"
  );
}

async function readJson(fsPromises, filePath) {
  try {
    return JSON.parse(String(await fsPromises.readFile(filePath, "utf8")));
  } catch {
    throw new MetaSamRunError("validation");
  }
}

async function existingCheckpoint(fsPromises, resultPath, rawPath, manifest) {
  try {
    const resultStat = await fsPromises.lstat(resultPath);
    if (!resultStat.isFile() || resultStat.isSymbolicLink()) {
      throw new MetaSamRunError("validation");
    }
    const checkpoint = JSON.parse(String(await fsPromises.readFile(resultPath, "utf8")));
    if (!validateCheckpoint(checkpoint, manifest)) {
      throw new MetaSamRunError("validation");
    }
    const rawStat = await fsPromises.lstat(rawPath);
    if (!rawStat.isFile() || rawStat.isSymbolicLink()) {
      throw new MetaSamRunError("validation");
    }
    return checkpoint;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof MetaSamRunError) throw error;
    throw new MetaSamRunError("validation");
  }
}

async function atomicJsonWrite(fsPromises, targetPath, value) {
  const tempPath = `${targetPath}.tmp`;
  await removeOwnedFile(fsPromises, tempPath);
  try {
    await fsPromises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await fsPromises.chmod(tempPath, 0o600);
    await fsPromises.rename(tempPath, targetPath);
    await fsPromises.chmod(targetPath, 0o600);
  } finally {
    await removeOwnedFile(fsPromises, tempPath);
  }
}

export async function executeMetaSamRun(options = {}) {
  const {
    repositoryRoot = process.cwd(),
    runId,
    apiKey,
    fs: fsPromises = defaultFs,
    openStream = createReadStream,
    openBlob = openAsBlob,
    upload = uploadMetaVideo,
    requestSam = runMetaSam,
    removeRemote = deleteMetaFile,
    summarise = parseAndSummariseSamEvents,
    retry = withMetaRetry,
    fetch: fetchImpl = globalThis.fetch,
    maxAttempts = 3,
  } = options;

  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new MetaSamRunError("validation");
  }
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new MetaSamRunError("validation");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new MetaSamRunError("validation");
  }

  const runsRoot = path.resolve(repositoryRoot, "private", "runs");
  const runDir = path.resolve(runsRoot, runId);
  if (path.dirname(runDir) !== runsRoot || path.basename(runDir) !== runId) {
    throw new MetaSamRunError("validation");
  }

  try {
    const [realRunsRoot, realRunDir] = await Promise.all([
      fsPromises.realpath(runsRoot),
      fsPromises.realpath(runDir),
    ]);
    if (realRunDir !== path.join(realRunsRoot, runId)) {
      throw new MetaSamRunError("validation");
    }
    const manifestStat = await fsPromises.lstat(path.join(runDir, "run.json"));
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new MetaSamRunError("validation");
    }
  } catch (error) {
    if (error instanceof MetaSamRunError) throw error;
    throw new MetaSamRunError("validation");
  }

  const manifest = await readJson(fsPromises, path.join(runDir, "run.json"));
  validateManifest(manifest, runId);

  const samDir = path.join(runDir, "sam");
  const resultPath = path.join(samDir, "result.json");
  const rawPath = path.join(samDir, "events.jsonl");
  const rawTempPath = `${rawPath}.tmp`;
  const derivativePath = path.join(runDir, "analysis.mp4");
  let derivativeStat;
  try {
    derivativeStat = await fsPromises.lstat(derivativePath);
  } catch {
    throw new MetaSamRunError("validation");
  }
  if (
    !derivativeStat?.isFile?.() ||
    derivativeStat.isSymbolicLink() ||
    derivativeStat.size <= 0
  ) {
    throw new MetaSamRunError("validation");
  }
  if ((await hashFile(derivativePath, openStream)) !== manifest.derivative.sha256) {
    throw new MetaSamRunError("validation");
  }
  const checkpoint = await existingCheckpoint(fsPromises, resultPath, rawPath, manifest);
  if (checkpoint !== null) {
    if ((await hashFile(rawPath, openStream)) !== checkpoint.rawEventsSha256) {
      throw new MetaSamRunError("validation");
    }
    return { checkpoint, reused: true, runDir };
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "" || apiKey !== apiKey.trim()) {
    throw new MetaSamRunError("key");
  }

  await fsPromises.mkdir(samDir, { recursive: true, mode: 0o700 });
  await fsPromises.chmod(samDir, 0o700);
  await removeOwnedFile(fsPromises, rawTempPath);

  let remoteFile = null;
  let primaryFailure = null;
  let samResult = null;
  try {
    const blob = await openBlob(derivativePath, { type: "video/mp4" });
    remoteFile = await upload({ blob, apiKey, fetch: fetchImpl });
    samResult = await retry(
      async () => {
        await removeOwnedFile(fsPromises, rawTempPath);
        return requestSam({
          fileId: remoteFile.id,
          apiKey,
          fetch: fetchImpl,
          consumeEvents: async (events) => {
            const handle = await fsPromises.open(rawTempPath, "wx", 0o600);
            try {
              async function* recordedEvents() {
                for await (const event of events) {
                  await handle.write(`${JSON.stringify(event)}\n`);
                  yield event;
                }
              }
              return await summarise(recordedEvents(), {
                width: manifest.derivative.width,
                height: manifest.derivative.height,
                fps: manifest.derivative.fps,
                frameCount: Math.round(
                  manifest.derivative.durationSeconds * manifest.derivative.fps,
                ),
                prompt: META_SAM_CONCEPT,
              });
            } finally {
              await handle.close();
            }
          },
        });
      },
      { maxAttempts },
    );
  } catch (error) {
    primaryFailure = new MetaSamRunError(
      remoteFile === null ? "upload" : "request",
      error,
    );
  } finally {
    if (remoteFile !== null) {
      try {
        await removeRemote({ fileId: remoteFile.id, apiKey, fetch: fetchImpl });
      } catch {
        primaryFailure = new MetaSamRunError("remote-cleanup");
      }
    }
  }

  if (primaryFailure !== null || samResult === null) {
    await removeOwnedFile(fsPromises, rawTempPath);
    throw primaryFailure ?? new MetaSamRunError("request");
  }

  await fsPromises.chmod(rawTempPath, 0o600);
  const rawEventsSha256 = await hashFile(rawTempPath, openStream);
  await fsPromises.rename(rawTempPath, rawPath);
  await fsPromises.chmod(rawPath, 0o600);
  const completed = {
    derivativeSha256: manifest.derivative.sha256,
    model: META_SAM_MODEL,
    prompt: META_SAM_CONCEPT,
    rawEventsSha256,
    runId,
    schemaVersion: META_SAM_RUN_SCHEMA_VERSION,
    summary: samResult.summary,
    usage: samResult.usage,
  };
  await atomicJsonWrite(fsPromises, resultPath, completed);
  return { checkpoint: completed, reused: false, runDir };
}
