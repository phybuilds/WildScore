import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSegmentsToTimebase } from "./segment-timebase.mjs";

function detection(frame_index, marker = frame_index) {
  return {
    frame_index,
    marker,
    box: { bottom: 2, left: 0, right: 2, top: 0 },
  };
}

test("deterministically samples 15fps geometry onto a 10fps grid", () => {
  const input = [{
    segment_id: "seg-1",
    first_frame: 0,
    last_frame: 4,
    start_s: 0,
    end_s: 4 / 15,
    geometry: [0, 1, 2, 3, 4].map((frame) => detection(frame)),
  }];
  const before = JSON.stringify(input);
  const [result] = normalizeSegmentsToTimebase(input, 15, 10);
  assert.deepEqual(result.geometry.map(({ frame_index, marker }) => [frame_index, marker]), [
    [0, 0],
    [1, 1],
    [2, 3],
    [3, 4],
  ]);
  assert.equal(result.first_frame, 0);
  assert.equal(result.last_frame, 3);
  assert.equal(result.end_s, 0.3);
  assert.equal(JSON.stringify(input), before);
});

test("keeps the closest source sample", () => {
  const [result] = normalizeSegmentsToTimebase([{
    segment_id: "seg-1",
    geometry: [detection(1, "earlier"), detection(2, "later")],
  }], 20, 10);
  assert.deepEqual(result.geometry.map(({ marker }) => marker), ["later"]);
});

test("rejects unsafe inputs and duplicate segment IDs", () => {
  assert.throws(() => normalizeSegmentsToTimebase([], 0, 10), /sourceFps/u);
  assert.throws(
    () => normalizeSegmentsToTimebase([{ segment_id: "../bad", geometry: [detection(0)] }], 15, 10),
    /segment is invalid/u,
  );
  const valid = { segment_id: "seg-1", geometry: [detection(0)] };
  assert.throws(() => normalizeSegmentsToTimebase([valid, valid], 15, 10), /unique/u);
});
