import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "./args.mjs";

test("parses keyless demo options", () => {
  assert.deepEqual(parseCliArgs(["--demo"]), {
    mode: "demo",
    checkOnly: false,
    port: 4173,
  });
  assert.deepEqual(parseCliArgs(["demo", "--check", "--port=5000"]), {
    mode: "demo",
    checkOnly: true,
    port: 5000,
  });
});

test("rejects unknown commands and unsafe ports", () => {
  assert.throws(() => parseCliArgs(["analyse"]), /--demo/u);
  assert.throws(() => parseCliArgs(["--demo", "--port=80"]), /1024/u);
  assert.throws(() => parseCliArgs(["--demo", "--wat"]), /Unknown/u);
});
