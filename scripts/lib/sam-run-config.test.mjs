import assert from "node:assert/strict";
import test from "node:test";

import { resolveSamRunConfig } from "./sam-run-config.mjs";

test("preserves the default hero feasibility configuration", () => {
  assert.deepEqual(resolveSamRunConfig([]), {
    clipId: "hero",
    analysisFps: 10,
    prompt: "animal",
    mediaFileName: "clip-01-analysis-10fps.mp4",
    runsRoot: "private/model-runs",
    runPurpose: "hero_feasibility",
  });
});

test("uses a separate locked destination for held-out evaluation", () => {
  assert.deepEqual(
    resolveSamRunConfig(["--clip=heldout-02", "--fps=10"]),
    {
      clipId: "heldout-02",
      analysisFps: 10,
      prompt: "animal",
      mediaFileName: "heldout-02-analysis-10fps.mp4",
      runsRoot: "private/model-evaluation/heldout-02",
      runPurpose: "held_out_evaluation",
    },
  );
});

test("rejects targeted prompts and alternate frame rates for held-out data", () => {
  assert.throws(
    () => resolveSamRunConfig(["--clip=heldout-02", "--prompt=antelope"]),
    /locked to the animal prompt at 10 fps/u,
  );
  assert.throws(
    () => resolveSamRunConfig(["--clip=heldout-02", "--fps=15"]),
    /locked to the animal prompt at 10 fps/u,
  );
});

test("rejects unrecognised clip selectors", () => {
  assert.throws(
    () => resolveSamRunConfig(["--clip=arbitrary-path"]),
    /Usage/u,
  );
});
