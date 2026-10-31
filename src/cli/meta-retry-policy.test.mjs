import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableError,
  parseRetryAfterMs,
  resolveRetryDelayMs,
  withMetaRetry,
  META_RETRY_MAX_WAIT_MS,
} from "./meta-retry-policy.mjs";

function httpError(status, extra = {}) {
  return { status, ...extra };
}

function stubDeps(overrides = {}) {
  const sleeps = [];
  return {
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("withMetaRetry: happy paths", () => {
  it("returns the first-attempt value without sleeping", async () => {
    const deps = stubDeps();
    const result = await withMetaRetry(async () => "ok", deps);
    assert.equal(result, "ok");
    assert.deepEqual(deps.sleeps, []);
  });

  it("returns sync values without sleeping", async () => {
    const deps = stubDeps();
    const result = await withMetaRetry(() => 42, deps);
    assert.equal(result, 42);
    assert.deepEqual(deps.sleeps, []);
  });

  it("retries once then succeeds", async () => {
    const deps = stubDeps();
    let calls = 0;
    const result = await withMetaRetry(() => {
      calls += 1;
      if (calls === 1) throw httpError(503);
      return "recovered";
    }, deps);
    assert.equal(result, "recovered");
    assert.equal(calls, 2);
    assert.equal(deps.sleeps.length, 1);
  });

  it("throws the original error after three total attempts", async () => {
    const deps = stubDeps();
    let calls = 0;
    const original = httpError(503);
    await assert.rejects(
      withMetaRetry(() => {
        calls += 1;
        throw original;
      }, deps),
      (error) => error === original,
    );
    assert.equal(calls, 3);
    assert.equal(deps.sleeps.length, 2);
  });
});

describe("isRetryableError: every retryable class", () => {
  it("retries HTTP 429", () => {
    assert.equal(isRetryableError(httpError(429)), true);
  });

  it("retries HTTP 500 and 599 boundaries", () => {
    assert.equal(isRetryableError(httpError(500)), true);
    assert.equal(isRetryableError(httpError(503)), true);
    assert.equal(isRetryableError(httpError(599)), true);
  });

  it("retries explicitly identified timeout errors", () => {
    assert.equal(isRetryableError({ isTimeout: true }), true);
  });

  it("retries explicitly identified connection errors", () => {
    assert.equal(isRetryableError({ isConnectionError: true }), true);
  });

});

describe("isRetryableError: permanent 4xx", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    it(`never retries HTTP ${status}`, () => {
      assert.equal(isRetryableError(httpError(status)), false);
    });
  }

  it("does not retry status-less plain errors", () => {
    assert.equal(isRetryableError(new Error("boom")), false);
    assert.equal(isRetryableError({}), false);
    assert.equal(isRetryableError(null), false);
  });

  it("does not let timeout or connection flags override a permanent status", () => {
    assert.equal(isRetryableError({ status: 400, isTimeout: true }), false);
    assert.equal(isRetryableError({ status: 401, isConnectionError: true }), false);
  });

  it("does not call sleep for permanent 4xx", async () => {
    const deps = stubDeps();
    let calls = 0;
    const original = httpError(403);
    await assert.rejects(
      withMetaRetry(() => {
        calls += 1;
        throw original;
      }, deps),
      (error) => error === original,
    );
    assert.equal(calls, 1);
    assert.deepEqual(deps.sleeps, []);
  });
});

describe("Retry-After handling", () => {
  it("honours numeric seconds", async () => {
    const deps = stubDeps();
    let calls = 0;
    const result = await withMetaRetry(() => {
      calls += 1;
      if (calls === 1) throw httpError(429, { retryAfter: 2 });
      return "ok";
    }, deps);
    assert.equal(result, "ok");
    assert.deepEqual(deps.sleeps, [2000]);
  });

  it("honours numeric-string seconds", () => {
    assert.equal(parseRetryAfterMs("2", 0), 2000);
  });

  it("honours an HTTP date relative to now()", () => {
    const now = 1_700_000_000_000;
    const date = new Date(now + 5000).toUTCString();
    assert.equal(parseRetryAfterMs(date, now), 5000);
  });

  it("waits the HTTP-date delay through the retry loop", async () => {
    const now = 1_700_000_000_000;
    const deps = stubDeps({ now: () => now });
    let calls = 0;
    const date = new Date(now + 3000).toUTCString();
    await withMetaRetry(() => {
      calls += 1;
      if (calls === 1) throw httpError(429, { retryAfter: date });
      return "ok";
    }, deps);
    assert.deepEqual(deps.sleeps, [3000]);
  });

  it("treats past HTTP dates as zero wait", () => {
    const now = 1_700_000_000_000;
    const past = new Date(now - 1000).toUTCString();
    assert.equal(parseRetryAfterMs(past, now), 0);
  });

  it("ignores invalid Retry-After values and falls back to backoff", () => {
    assert.equal(parseRetryAfterMs(-1, 0), undefined);
    assert.equal(parseRetryAfterMs("not-a-date", 0), undefined);
    assert.equal(parseRetryAfterMs({}, 0), undefined);
    const delay = resolveRetryDelayMs(httpError(429, { retryAfter: "nope" }), 0, {
      random: () => 0,
      now: () => 0,
    });
    assert.equal(delay, 250);
  });
});

describe("jitter bounds and 60-second cap", () => {
  it("maps random()=0 to half the ceiling and random()~1 to the ceiling", () => {
    const low = resolveRetryDelayMs(httpError(503), 0, {
      random: () => 0,
      now: () => 0,
    });
    const high = resolveRetryDelayMs(httpError(503), 0, {
      random: () => 1,
      now: () => 0,
    });
    assert.equal(low, 250);
    assert.equal(high, 500);
  });

  it("doubles the ceiling per retry (500ms base)", () => {
    const first = resolveRetryDelayMs(httpError(503), 0, {
      random: () => 1,
      now: () => 0,
    });
    const second = resolveRetryDelayMs(httpError(503), 1, {
      random: () => 1,
      now: () => 0,
    });
    assert.equal(first, 500);
    assert.equal(second, 1000);
  });

  it("stays within [ceiling/2, ceiling] for mid-range jitter", () => {
    const delay = resolveRetryDelayMs(httpError(500), 1, {
      random: () => 0.5,
      now: () => 0,
    });
    assert.equal(delay, 750);
  });

  it("caps numeric Retry-After at 60 seconds", () => {
    assert.equal(parseRetryAfterMs(3600, 0), 3_600_000);
    const delay = resolveRetryDelayMs(httpError(429, { retryAfter: 3600 }), 0, {
      random: () => 0.5,
      now: () => 0,
    });
    assert.equal(delay, META_RETRY_MAX_WAIT_MS);
  });

  it("caps far-future HTTP dates at 60 seconds", () => {
    const now = 1_700_000_000_000;
    const far = new Date(now + 600_000).toUTCString();
    const delay = resolveRetryDelayMs(httpError(429, { retryAfter: far }), 0, {
      random: () => 0.5,
      now: () => now,
    });
    assert.equal(delay, META_RETRY_MAX_WAIT_MS);
  });

  it("rejects out-of-range random results instead of weakening bounds", () => {
    for (const bad of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          resolveRetryDelayMs(httpError(503), 0, {
            random: () => bad,
            now: () => 0,
          }),
        RangeError,
      );
    }
    assert.throws(
      () =>
        resolveRetryDelayMs(httpError(503), 0, {
          random: () => "0.5",
          now: () => 0,
        }),
      RangeError,
    );
  });
});

describe("invalid options", () => {
  it("rejects non-function operations", async () => {
    await assert.rejects(withMetaRetry(null, stubDeps()), TypeError);
  });

  for (const bad of [0, 4, 1.5, Number.NaN, "3", null]) {
    it(`rejects maxAttempts=${String(bad)}`, async () => {
      await assert.rejects(
        withMetaRetry(async () => "ok", stubDeps({ maxAttempts: bad })),
        RangeError,
      );
    });
  }

  it("accepts maxAttempts=1 with no retry", async () => {
    const deps = stubDeps({ maxAttempts: 1 });
    let calls = 0;
    const original = httpError(503);
    await assert.rejects(
      withMetaRetry(() => {
        calls += 1;
        throw original;
      }, deps),
      (error) => error === original,
    );
    assert.equal(calls, 1);
    assert.deepEqual(deps.sleeps, []);
  });

  it("rejects non-function sleep/random/now", async () => {
    await assert.rejects(
      withMetaRetry(async () => "ok", stubDeps({ sleep: null })),
      TypeError,
    );
    await assert.rejects(
      withMetaRetry(async () => "ok", stubDeps({ random: null })),
      TypeError,
    );
    await assert.rejects(
      withMetaRetry(async () => "ok", stubDeps({ now: null })),
      TypeError,
    );
  });
});
