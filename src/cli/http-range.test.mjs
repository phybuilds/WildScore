import assert from "node:assert/strict";
import test from "node:test";

import { parseByteRange } from "./http-range.mjs";

test("parses bounded, open and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { satisfiable: true, start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { satisfiable: true, start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { satisfiable: true, start: 90, end: 99 });
});

test("rejects multiple, reversed and out-of-bounds ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-1,5-6", 100), { satisfiable: false });
  assert.deepEqual(parseByteRange("bytes=20-10", 100), { satisfiable: false });
  assert.deepEqual(parseByteRange("bytes=100-", 100), { satisfiable: false });
});
