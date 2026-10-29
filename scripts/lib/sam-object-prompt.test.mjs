import assert from "node:assert/strict";
import test from "node:test";

import { buildSamBoxPrompt } from "./sam-object-prompt.mjs";

test("builds the documented video box-prompt grammar", () => {
  assert.equal(
    buildSamBoxPrompt({
      frameIndex: 12,
      objectId: 3,
      box: { left: 10, top: 20, right: 30, bottom: 40 },
      width: 100,
      height: 80,
    }),
    "<12f>3<|box;x1=10;y1=20;x2=30;y2=40;w=100;h=80|>",
  );
});

test("rejects invalid identifiers and out-of-bounds boxes", () => {
  const base = {
    frameIndex: 12,
    objectId: 1,
    box: { left: 10, top: 10, right: 20, bottom: 20 },
    width: 100,
    height: 100,
  };
  assert.throws(() => buildSamBoxPrompt({ ...base, objectId: 0 }), /objectId/u);
  assert.throws(
    () => buildSamBoxPrompt({ ...base, box: { ...base.box, right: 100 } }),
    /inside the media bounds/u,
  );
  assert.throws(
    () => buildSamBoxPrompt({ ...base, frameIndex: 1.5 }),
    /frameIndex must be an integer/u,
  );
});
