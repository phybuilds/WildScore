#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAnalysisPreflight } from "../src/cli/analysis-preflight.mjs";
import { executeFullAnalysisPipeline, executeSamEventPipeline } from "../src/cli/analysis-pipeline.mjs";
import { parseCliArgs } from "../src/cli/args.mjs";
import { verifyDemoAssets } from "../src/cli/demo-integrity.mjs";
import { runDoctor } from "../src/cli/doctor.mjs";
import { parseByteRange } from "../src/cli/http-range.mjs";
import { MetaSamRunError } from "../src/cli/meta-sam-run.mjs";
import { loadRecoveryBatch } from "../src/cli/recovery-batch.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEMO_DIRECTORY = path.join(REPOSITORY_ROOT, "web/public/demo");
const STATIC_DIRECTORY = path.join(REPOSITORY_ROOT, "web/out");
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".txt", "text/plain; charset=utf-8"],
]);

function printHelp() {
  console.log([
    "WildScore",
    "",
    "  wildscore --demo [--check] [--port 4173]",
    "  wildscore doctor",
    "  wildscore view <run-id> [--port 4173]",
    "  wildscore analyse <local-video> --dry-run [--max-seconds 30] [--max-calls 8]",
    "  wildscore analyse <local-video> --prepare-only [--max-seconds 30]",
    "  wildscore analyse <local-video> --sam-only --yes [--max-seconds 30] [--max-calls 3]",
    "  wildscore analyse <local-video> --full --yes [--max-seconds 30] [--max-calls 8]",
    "  wildscore recover <batch.json> --dry-run [--max-calls 8]",
    "",
    "Replays the bundled cached analysis without an API key or model call.",
    "--check verifies bundled asset integrity without building or serving.",
  ].join("\n"));
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const childEnvironment = { ...process.env };
    delete childEnvironment.MODEL_API_KEY;
    const child = spawn(command, ["run", "build"], {
      cwd: REPOSITORY_ROOT,
      env: childEnvironment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Static build failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`));
    });
  });
}

async function resolveStaticFile(requestUrl, runBundleDirectory = null) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  if (runBundleDirectory !== null && pathname.startsWith("/demo/")) {
    const runAssets = new Map([
      ["/demo/bundle.json", "bundle.json"],
      ["/demo/recovery-candidates.json", "recovery-candidates.json"],
      ["/demo/analysis.mp4", "analysis.mp4"],
    ]);
    const asset = runAssets.get(pathname);
    if (!asset) return null;
    const resolvedRunAsset = path.join(runBundleDirectory, asset);
    try {
      return (await stat(resolvedRunAsset)).isFile() ? resolvedRunAsset : null;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(STATIC_DIRECTORY, requested);
  if (resolved !== STATIC_DIRECTORY && !resolved.startsWith(`${STATIC_DIRECTORY}${path.sep}`)) {
    return null;
  }
  try {
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function serveDemo(port, runBundleDirectory = null) {
  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    try {
      const filePath = await resolveStaticFile(request.url ?? "/", runBundleDirectory);
      if (!filePath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found\n");
        return;
      }
      const details = await stat(filePath);
      const range = parseByteRange(request.headers.range, details.size);
      if (range && !range.satisfiable) {
        response.writeHead(416, { "Content-Range": `bytes */${details.size}` });
        response.end();
        return;
      }
      const responseHeaders = {
        "Content-Type": CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(range ? range.end - range.start + 1 : details.size),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      };
      if (range) responseHeaders["Content-Range"] = `bytes ${range.start}-${range.end}/${details.size}`;
      response.writeHead(range ? 206 : 200, responseHeaders);
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined).pipe(response);
    } catch {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to serve the demo.\n");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`WildScore ${runBundleDirectory ? "private run" : "cached demo"}: http://127.0.0.1:${port}/`);
  console.log("No API key was loaded and no model call will be made while viewing. Press Ctrl-C to stop.");
  const stop = () => server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

try {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.mode === "help") {
    printHelp();
  } else if (options.mode === "doctor") {
    const code = await runDoctor();
    if (code !== 0) process.exitCode = code;
  } else if (options.mode === "view") {
    const runBundleDirectory = path.join(
      REPOSITORY_ROOT,
      "private",
      "runs",
      options.runId,
      "bundle",
    );
    await Promise.all([
      stat(path.join(runBundleDirectory, "bundle.json")),
      stat(path.join(runBundleDirectory, "recovery-candidates.json")),
      stat(path.join(runBundleDirectory, "analysis.mp4")),
    ]);
    await runBuild();
    await serveDemo(options.port, runBundleDirectory);
  } else if (options.mode === "analyse") {
    await runAnalysisPreflight({
      videoPath: options.videoPath,
      maxSeconds: options.maxSeconds,
      maxCalls: options.maxCalls,
      log: options.prepareOnly ? () => {} : console.log,
    });
    if (options.prepareOnly) {
      const { prepareAnalysisRun } = await import("../src/cli/run-preparation.mjs");
      await prepareAnalysisRun({
        videoPath: options.videoPath,
        maxSeconds: options.maxSeconds,
        repositoryRoot: REPOSITORY_ROOT,
      });
    } else if (options.samOnly) {
        const result = await executeSamEventPipeline({
          videoPath: options.videoPath,
          maxSeconds: options.maxSeconds,
          maxCalls: options.maxCalls,
          repositoryRoot: REPOSITORY_ROOT,
          apiKey: process.env.MODEL_API_KEY,
        });
        console.log(
          result.sam.reused
            ? "Verified and reused the private SAM checkpoint; no model call was made."
            : `SAM completed and remote input deletion was confirmed. Parsed ${result.sam.checkpoint.summary.track_count} track${result.sam.checkpoint.summary.track_count === 1 ? "" : "s"}.`,
        );
        console.log(
          `${result.events.reused ? "Reused" : "Created"} deterministic event evidence: ${result.events.checkpoint.segments.length} presence segments and ${result.events.checkpoint.events.length} event proposals.`,
        );
        console.log("Created a private geometry-only viewer bundle. Spark labelling is not part of --sam-only.");
    } else if (options.full) {
      const result = await executeFullAnalysisPipeline({
        videoPath: options.videoPath,
        maxSeconds: options.maxSeconds,
        maxCalls: options.maxCalls,
        repositoryRoot: REPOSITORY_ROOT,
        apiKey: process.env.MODEL_API_KEY,
      });
      console.log(
        `Full private analysis completed with ${result.events.checkpoint.segments.length} presence segments, ${result.events.checkpoint.events.length} event proposals, and ${result.spark.checkpoint.labelProposals.length} validated Spark label proposals.`,
      );
      console.log(`View it with: node bin/wildscore.mjs view ${result.prepared.runId}`);
    }
  } else if (options.mode === "recover") {
    const plan = await loadRecoveryBatch(options.batchPath, options.maxCalls);
    console.log(`Recovery preflight passed for ${plan.annotationCount} annotation${plan.annotationCount === 1 ? "" : "s"}.`);
    console.log(`Planned model: ${plan.model}; maximum calls: ${plan.maxCalls}.`);
    console.log("Optional broad labels will not be included in SAM geometry prompts. No model call was made.");
  } else {
    const manifest = await verifyDemoAssets(DEMO_DIRECTORY);
    console.log(`Verified ${Object.keys(manifest.assets).length} bundled demo assets.`);
    if (!options.checkOnly) {
      await runBuild();
      await serveDemo(options.port);
    }
  }
} catch (error) {
  console.error(`WildScore: ${error instanceof Error ? error.message : "Unknown error."}`);
  if (error instanceof MetaSamRunError) {
    process.exitCode = error.stage === "key" ? 3 : error.stage === "validation" ? 6 : 4;
  } else {
    process.exitCode = 2;
  }
}
