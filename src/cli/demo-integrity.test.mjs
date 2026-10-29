import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyDemoAssets } from "./demo-integrity.mjs";

test("verifies a manifest and rejects changed cached assets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wildscore-demo-"));
  const asset = Buffer.from("cached output");
  await writeFile(path.join(directory, "bundle.json"), asset);
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    schema: "wildscore-demo-manifest-v1",
    assets: {
      "bundle.json": createHash("sha256").update(asset).digest("hex"),
    },
  }));

  await assert.doesNotReject(verifyDemoAssets(directory));
  await writeFile(path.join(directory, "bundle.json"), "changed");
  await assert.rejects(verifyDemoAssets(directory), /integrity verification/u);
});

test("rejects traversal-like manifest asset names", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wildscore-demo-"));
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    schema: "wildscore-demo-manifest-v1",
    assets: { "../private.json": "0".repeat(64) },
  }));
  await assert.rejects(verifyDemoAssets(directory), /invalid asset entry/u);
});
