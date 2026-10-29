import assert from "node:assert/strict";
import test from "node:test";

import {
  containedVideoDragToMediaBox,
  createMissingAnimalAnnotation,
} from "./missing-animal-annotation.ts";

test("maps a full contained video drag to inclusive source pixels", () => {
  assert.deepEqual(containedVideoDragToMediaBox({
    mediaWidth: 1920,
    mediaHeight: 1080,
    viewportWidth: 960,
    viewportHeight: 540,
    start: { x: 0, y: 0 },
    end: { x: 960, y: 540 },
  }), { left: 0, top: 0, right: 1919, bottom: 1079 });
});

test("removes letterboxing, accepts reverse drag, and clamps to video bounds", () => {
  assert.deepEqual(containedVideoDragToMediaBox({
    mediaWidth: 100,
    mediaHeight: 100,
    viewportWidth: 200,
    viewportHeight: 100,
    start: { x: 175, y: 75 },
    end: { x: 25, y: 25 },
  }), { left: 0, top: 25, right: 99, bottom: 74 });
});

test("rejects a drag entirely inside letterboxing", () => {
  assert.throws(() => containedVideoDragToMediaBox({
    mediaWidth: 100,
    mediaHeight: 100,
    viewportWidth: 200,
    viewportHeight: 100,
    start: { x: 10, y: 10 },
    end: { x: 20, y: 20 },
  }), /visible area/u);
});

test("rejects non-integer source-media dimensions", () => {
  assert.throws(() => containedVideoDragToMediaBox({
    mediaWidth: 100.5,
    mediaHeight: 100,
    viewportWidth: 200,
    viewportHeight: 100,
    start: { x: 50, y: 10 },
    end: { x: 100, y: 50 },
  }), /mediaWidth must be a positive integer/u);
});

test("creates an exportable annotation without requiring a species label", () => {
  assert.deepEqual(createMissingAnimalAnnotation({
    frameIndex: 12,
    timestampSeconds: 1.2,
    broadLabel: "  ",
    box: { left: 10, top: 20, right: 30, bottom: 40 },
  }), {
    schema: "wildscore-missing-animal-annotation-v1",
    frame_index: 12,
    timestamp_s: 1.2,
    broad_label: null,
    prompt_kind: "box",
    box: { left: 10, top: 20, right: 30, bottom: 40 },
  });
});
