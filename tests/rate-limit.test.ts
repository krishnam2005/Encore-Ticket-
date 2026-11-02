import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { AppError } from "@/lib/errors";
import { checkRateLimit, enforceRateLimit, resetRateLimits } from "@/lib/rate-limit";

const req = (ip: string): Request => new Request("http://localhost/x", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit, then blocks", () => {
    const results = Array.from({ length: 5 }, () => checkRateLimit("k", 3, 60_000, 1_000));
    assert.deepEqual(
      results.map((r) => r.allowed),
      [true, true, true, false, false],
    );
    assert.equal(results[2]?.remaining, 0);
  });

  it("opens a fresh window after it elapses", () => {
    for (let i = 0; i < 4; i++) checkRateLimit("k", 3, 60_000, 1_000);
    assert.equal(checkRateLimit("k", 3, 60_000, 1_000).allowed, false);
    assert.equal(checkRateLimit("k", 3, 60_000, 61_001).allowed, true);
  });

  it("counts clients separately", () => {
    for (let i = 0; i < 4; i++) checkRateLimit("a", 3, 60_000, 1_000);
    assert.equal(checkRateLimit("a", 3, 60_000, 1_000).allowed, false);
    assert.equal(checkRateLimit("b", 3, 60_000, 1_000).allowed, true);
  });

  it("enforceRateLimit throws a structured 429 with Retry-After, keyed on the first x-forwarded-for hop", () => {
    enforceRateLimit(req("1.2.3.4"), "holds", 1);
    assert.throws(
      () => enforceRateLimit(req("1.2.3.4"), "holds", 1),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 429 &&
        err.code === "RATE_LIMITED" &&
        typeof err.headers?.["retry-after"] === "string",
    );
    assert.doesNotThrow(() => enforceRateLimit(req("5.6.7.8"), "holds", 1)); // different client
  });

  it("a limit of 0 or less disables the check", () => {
    for (let i = 0; i < 50; i++) assert.doesNotThrow(() => enforceRateLimit(req("9.9.9.9"), "holds", 0));
  });
});
