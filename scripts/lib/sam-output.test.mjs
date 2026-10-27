import assert from "node:assert/strict";
import test from "node:test";

import { parseAndSummariseSamEvents } from "./sam-output.mjs";

const mask =
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
const outputText =
  `<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>${mask}\n` +
  `<2f>2<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>${mask}\n`;

async function* syntheticEvents() {
  yield {
    type: "response.output_text.delta",
    item_id: "synthetic",
    output_index: 0,
    content_index: 0,
    delta: outputText,
  };
  yield {
    type: "response.output_text.done",
    item_id: "synthetic",
    output_index: 0,
    content_index: 0,
    text: outputText,
  };
  yield { type: "response.completed" };
}

test("uses explicit skipped frame indices and sparse object ids", async () => {
  const summary = await parseAndSummariseSamEvents(syntheticEvents(), {
    width: 320,
    height: 334,
    fps: 10,
    frameCount: 3,
    prompt: "synthetic fixture",
  });

  assert.deepEqual(summary.object_ids, ["0", "2"]);
  assert.equal(summary.emitted_frame_count, 2);
  assert.equal(summary.first_emitted_frame, 0);
  assert.equal(summary.last_emitted_frame, 2);
  assert.equal(summary.box_count, 2);
  assert.equal(summary.mask_count, 2);
});
