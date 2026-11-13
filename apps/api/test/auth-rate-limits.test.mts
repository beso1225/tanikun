import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  UNKNOWN_TRUSTED_ADDRESS,
  createAuthRateLimiter,
  decodeRateLimitKey,
  trustedClientAddress,
} from "../rate-limits/limiter.mjs";
import {
  AUTH_RATE_LIMIT_POLICIES,
  AUTH_RATE_LIMIT_STORAGE,
  AUTH_ROUTE_RATE_LIMIT_POLICIES,
  rateLimitPoliciesForRoute,
} from "../rate-limits/policy.mjs";
import {
  base64Url,
  bytes,
  countRows,
  expectAuthError,
  fakeClock,
  queryAll,
  queryFirst,
  resetAuthDatabase,
} from "./auth-fixtures.mts";

const KEY = bytes(32, 0x7a);
const RATE_KEY = base64Url(KEY);

beforeEach(resetAuthDatabase);

function captureSyncError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return null;
}

function addressRequest({
  cf = { colo: "TST" },
  noCf = false,
  address,
  forged = {},
} = {}) {
  const request = new Request("https://localhost:4300/api/v1/auth/session");
  if (!noCf)
    Object.defineProperty(request, "cf", {
      value: cf,
      configurable: true,
    });
  if (address !== undefined) request.headers.set("CF-Connecting-IP", address);
  for (const [name, value] of Object.entries(forged))
    request.headers.set(name, value);
  return request;
}

async function limiterFor({
  clock = fakeClock(),
  request = addressRequest(),
  key = KEY,
} = {}) {
  return {
    clock,
    limiter: await createAuthRateLimiter({
      db: env.DB,
      request,
      key,
      now: clock.now,
    }),
  };
}

async function counterRows() {
  return queryAll(
    "SELECT bucket_key, window_start, count, expires_at FROM auth_rate_limit_counters ORDER BY bucket_key",
  );
}

describe("canonical abuse-limit policy", () => {
  it("owns the accepted Phase 5 values and route mapping once", () => {
    expect(AUTH_RATE_LIMIT_POLICIES.challengeAddress).toEqual({
      id: "challenge_address",
      scope: "address",
      limit: 30,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.challengeBinding).toEqual({
      id: "challenge_binding",
      scope: "binding",
      limit: 5,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.registrationAddress).toMatchObject({
      scope: "address",
      limit: 10,
      windowMs: 3_600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.registrationBinding).toMatchObject({
      scope: "binding",
      limit: 5,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.signInAddress).toMatchObject({
      scope: "address",
      limit: 60,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.signInBinding).toMatchObject({
      scope: "binding",
      limit: 10,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.signInCredential).toMatchObject({
      scope: "credential",
      limit: 10,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.stepUpSession).toMatchObject({
      scope: "session",
      limit: 10,
      windowMs: 600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.credentialAccount).toMatchObject({
      scope: "account",
      limit: 10,
      windowMs: 3_600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.logoutAllAccount).toMatchObject({
      scope: "account",
      limit: 5,
      windowMs: 3_600_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.sessionStatusSession).toMatchObject({
      scope: "session",
      limit: 120,
      windowMs: 60_000,
    });
    expect(AUTH_RATE_LIMIT_POLICIES.syncSession).toMatchObject({
      scope: "session",
      limit: 120,
      windowMs: 60_000,
    });
    expect(AUTH_RATE_LIMIT_STORAGE).toEqual({
      retentionMs: 3_600_000,
      cleanupBatch: 100,
    });

    expect(
      AUTH_ROUTE_RATE_LIMIT_POLICIES.registration_verify.map(
        (policy) => policy.id,
      ),
    ).toEqual(["registration_address", "registration_binding"]);
    expect(
      AUTH_ROUTE_RATE_LIMIT_POLICIES.sign_in_verify.map((policy) => policy.id),
    ).toEqual(["sign_in_address", "sign_in_binding", "sign_in_credential"]);
    expect(
      AUTH_ROUTE_RATE_LIMIT_POLICIES.credential_add_options.map(
        (policy) => policy.id,
      ),
    ).toEqual(["challenge_address", "challenge_binding", "credential_account"]);
    expect(
      AUTH_ROUTE_RATE_LIMIT_POLICIES.credential_remove.map(
        (policy) => policy.id,
      ),
    ).toEqual(["credential_account"]);
    expect(
      AUTH_ROUTE_RATE_LIMIT_POLICIES.sync_request.map((policy) => policy.id),
    ).toEqual(["sync_session"]);
    expect(AUTH_ROUTE_RATE_LIMIT_POLICIES.logout).toEqual([]);
    expect(rateLimitPoliciesForRoute("not_a_route")).toBeNull();
  });

  it("accepts only a canonical 32-byte AUTH_RATE_LIMIT_KEY", () => {
    expect(decodeRateLimitKey(RATE_KEY)).toEqual(KEY);
    for (const value of [
      undefined,
      "",
      "not-base64url",
      base64Url(bytes(31)),
    ]) {
      expect(captureSyncError(() => decodeRateLimitKey(value))).toMatchObject({
        code: "temporarily_unavailable",
      });
    }
  });
});

describe("trusted client address", () => {
  it("uses CF-Connecting-IP only when request.cf metadata is present", () => {
    expect(
      trustedClientAddress(
        addressRequest({ noCf: true, address: "203.0.113.7" }),
      ),
    ).toBe(UNKNOWN_TRUSTED_ADDRESS);
    expect(
      trustedClientAddress(
        addressRequest({ cf: null, address: "203.0.113.7" }),
      ),
    ).toBe(UNKNOWN_TRUSTED_ADDRESS);
    expect(
      trustedClientAddress(
        addressRequest({ cf: { colo: "TST" }, address: "203.0.113.7" }),
      ),
    ).toBe("203.0.113.7");
    expect(
      trustedClientAddress(
        addressRequest({ cf: { colo: "TST" }, address: "2001:DB8::1" }),
      ),
    ).toBe("2001:db8::1");
  });

  it("never trusts forwarding headers or malformed address values", () => {
    expect(
      trustedClientAddress(
        addressRequest({
          noCf: true,
          address: "203.0.113.7",
          forged: {
            "X-Forwarded-For": "198.51.100.1",
            Forwarded: "for=198.51.100.2",
            "X-Real-IP": "198.51.100.3",
          },
        }),
      ),
    ).toBe(UNKNOWN_TRUSTED_ADDRESS);
    expect(
      trustedClientAddress(
        addressRequest({
          cf: { colo: "TST" },
          address: "fe80::1%eth0",
        }),
      ),
    ).toBe(UNKNOWN_TRUSTED_ADDRESS);
    expect(
      trustedClientAddress(
        addressRequest({
          cf: { colo: "TST" },
          forged: { "CF-Connecting-IP": "203.0.113.7, 198.51.100.1" },
        }),
      ),
    ).toBe(UNKNOWN_TRUSTED_ADDRESS);
    expect(
      trustedClientAddress(
        addressRequest({
          cf: { colo: "TST" },
          forged: { "CF-Connecting-IP": "not-an-address" },
        }),
      ),
    ).toBe(UNKNOWN_TRUSTED_ADDRESS);
  });
});

describe("D1 fixed windows", () => {
  it("stores only keyed 43-character digests and separates policy domains", async () => {
    const { limiter } = await limiterFor();
    await limiter.enforce(
      [
        AUTH_RATE_LIMIT_POLICIES.challengeBinding,
        AUTH_RATE_LIMIT_POLICIES.signInBinding,
      ],
      { binding: bytes(32, 0x31) },
    );
    await limiter.enforce([AUTH_RATE_LIMIT_POLICIES.logoutAllAccount], {
      account: "acct_alice0001",
    });
    await limiter.enforce([AUTH_RATE_LIMIT_POLICIES.challengeAddress], {
      address: "203.0.113.7",
    });
    const rows = await counterRows();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.bucket_key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(row.count).toBe(1);
      expect(row.bucket_key).not.toContain("acct_alice0001");
      expect(row.bucket_key).not.toContain("203.0.113.7");
    }
    expect(new Set(rows.map((row) => row.bucket_key)).size).toBe(4);
    const stored = await queryFirst(
      "SELECT group_concat(bucket_key) AS keys FROM auth_rate_limit_counters",
    );
    expect(stored.keys).not.toContain(RATE_KEY);
    expect(stored.keys).not.toContain(base64Url(bytes(32, 0x31)));

    await limiter.enforce([AUTH_RATE_LIMIT_POLICIES.challengeBinding], {
      binding: bytes(32, 0x31),
    });
    const repeated = await queryFirst(
      "SELECT count FROM auth_rate_limit_counters WHERE count = 2",
    );
    expect(repeated.count).toBe(2);
  });

  it("admits exactly the limit and recovers at the fixed-window boundary", async () => {
    const clock = fakeClock();
    const window = AUTH_RATE_LIMIT_POLICIES.logoutAllAccount.windowMs;
    clock.set(Math.floor(clock.current() / window) * window);
    const { limiter } = await limiterFor({ clock });
    const policy = AUTH_RATE_LIMIT_POLICIES.logoutAllAccount;

    for (let index = 0; index < policy.limit; index += 1)
      await limiter.enforce([policy], { account: "acct_boundary" });
    const blocked = await expectAuthError(
      () => limiter.enforce([policy], { account: "acct_boundary" }),
      { code: "rate_limited" },
    );
    expect(blocked.retryAfter).toBe(3600);
    expect(Number.isSafeInteger(blocked.retryAfter)).toBe(true);

    clock.set(clock.current() + window - 1);
    const lastSecond = await expectAuthError(
      () => limiter.enforce([policy], { account: "acct_boundary" }),
      { code: "rate_limited" },
    );
    expect(lastSecond.retryAfter).toBe(1);

    clock.set(clock.current() + 1);
    await expect(
      limiter.enforce([policy], { account: "acct_boundary" }),
    ).resolves.toBeUndefined();
    expect(await countRows("auth_rate_limit_counters")).toBe(2);
  });

  it("admits only the limit under concurrent requests", async () => {
    const { limiter } = await limiterFor();
    const policy = AUTH_RATE_LIMIT_POLICIES.logoutAllAccount;
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        limiter.enforce([policy], { account: "acct_concurrent" }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    expect(
      results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason),
    ).toEqual(Array(7).fill(expect.objectContaining({ code: "rate_limited" })));
    expect(
      await queryFirst(
        "SELECT count FROM auth_rate_limit_counters WHERE count = 5",
      ),
    ).toEqual({ count: 5 });
  });

  it("keeps scopes isolated and falls back to one shared unknown address bucket", async () => {
    const clock = fakeClock();
    const request = addressRequest({
      noCf: true,
      address: "198.51.100.10",
    });
    const { limiter } = await limiterFor({ clock, request });
    const policy = AUTH_RATE_LIMIT_POLICIES.challengeAddress;
    for (let index = 0; index < policy.limit; index += 1)
      await limiter.enforce([policy], { address: limiter.address });
    await expectAuthError(
      () => limiter.enforce([policy], { address: limiter.address }),
      { code: "rate_limited" },
    );

    const otherRequest = addressRequest({
      noCf: true,
      address: "198.51.100.11",
    });
    const other = await limiterFor({ clock, request: otherRequest });
    await expectAuthError(
      () => other.limiter.enforce([policy], { address: other.limiter.address }),
      { code: "rate_limited" },
    );

    const trustedA = addressRequest({
      cf: { colo: "TST" },
      address: "203.0.113.20",
    });
    const trusted = await limiterFor({ clock, request: trustedA });
    for (let index = 0; index < policy.limit; index += 1)
      await trusted.limiter.enforce([policy], {
        address: trusted.limiter.address,
      });
    const trustedB = addressRequest({
      cf: { colo: "TST" },
      address: "203.0.113.21",
    });
    const isolated = await limiterFor({ clock, request: trustedB });
    await expect(
      isolated.limiter.enforce([policy], {
        address: isolated.limiter.address,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps binding, credential, session, and account scopes isolated", async () => {
    const { limiter } = await limiterFor();
    const cases = [
      [
        AUTH_RATE_LIMIT_POLICIES.challengeBinding,
        "binding",
        bytes(32, 1),
        bytes(32, 3),
      ],
      [AUTH_RATE_LIMIT_POLICIES.signInCredential, "credential", "AQ", "Ag"],
      [
        AUTH_RATE_LIMIT_POLICIES.stepUpSession,
        "session",
        bytes(32, 2),
        bytes(32, 4),
      ],
      [
        AUTH_RATE_LIMIT_POLICIES.credentialAccount,
        "account",
        "acct_a",
        "acct_b",
      ],
    ];
    for (const [policy, scope, first, second] of cases) {
      for (let index = 0; index < policy.limit; index += 1)
        await limiter.enforce([policy], { [scope]: first });
      await expectAuthError(
        () => limiter.enforce([policy], { [scope]: first }),
        { code: "rate_limited" },
      );
      await expect(
        limiter.enforce([policy], { [scope]: second }),
      ).resolves.toBeUndefined();
    }
  });

  it("does not increment a bucket that is already at its limit", async () => {
    const { limiter } = await limiterFor();
    const policy = AUTH_RATE_LIMIT_POLICIES.logoutAllAccount;
    for (let index = 0; index < policy.limit; index += 1)
      await limiter.enforce([policy], { account: "acct_partial" });
    await expectAuthError(
      () => limiter.enforce([policy], { account: "acct_partial" }),
      { code: "rate_limited" },
    );
    expect(
      await queryFirst(
        "SELECT count FROM auth_rate_limit_counters WHERE count = ?1",
        policy.limit,
      ),
    ).toEqual({ count: policy.limit });
    expect(await countRows("auth_rate_limit_counters")).toBe(1);
  });

  it("can conservatively consume another bucket in the same denied batch", async () => {
    const { limiter } = await limiterFor();
    const blockedPolicy = AUTH_RATE_LIMIT_POLICIES.logoutAllAccount;
    const otherPolicy = AUTH_RATE_LIMIT_POLICIES.credentialAccount;
    for (let index = 0; index < blockedPolicy.limit; index += 1)
      await limiter.enforce([blockedPolicy], { account: "acct_partial" });
    await expectAuthError(
      () =>
        limiter.enforce([blockedPolicy, otherPolicy], {
          account: "acct_partial",
        }),
      { code: "rate_limited" },
    );
    const counts = (await counterRows()).map((row) => row.count).toSorted();
    expect(counts).toEqual([1, 5]);
  });

  it("cleans expired rows in bounded batches without changing live rows", async () => {
    const clock = fakeClock();
    const { limiter } = await limiterFor({ clock });
    const insert = env.DB.prepare(
      "INSERT INTO auth_rate_limit_counters (bucket_key, window_start, count, expires_at) VALUES (?1, 0, 1, ?2)",
    );
    for (let index = 0; index < 105; index += 1)
      await insert
        .bind(base64Url(bytes(32, index % 250)), clock.current() - 1)
        .run();
    await insert
      .bind(base64Url(bytes(32, 251)), clock.current() + 60_000)
      .run();
    expect(await countRows("auth_rate_limit_counters")).toBe(106);
    expect(await limiter.cleanupExpired(10)).toBe(10);
    expect(await countRows("auth_rate_limit_counters")).toBe(96);
    expect(await limiter.cleanupExpired(100)).toBe(95);
    expect(await countRows("auth_rate_limit_counters")).toBe(1);
  });

  it("fails closed with a redacted 503 on counter storage failure", async () => {
    const clock = fakeClock();
    const { limiter } = await limiterFor({ clock });
    await env.DB.exec(
      "CREATE TRIGGER reject_rate_counter BEFORE INSERT ON auth_rate_limit_counters BEGIN SELECT RAISE(ABORT, 'sql-canary-should-not-escape'); END",
    );
    try {
      const error = await expectAuthError(
        () =>
          limiter.enforce([AUTH_RATE_LIMIT_POLICIES.logoutAllAccount], {
            account: "acct_storage",
          }),
        { code: "temporarily_unavailable" },
      );
      expect(error.message).toBe("temporarily_unavailable");
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain("sql-canary");
      expect(await countRows("auth_rate_limit_counters")).toBe(0);
    } finally {
      await env.DB.exec("DROP TRIGGER reject_rate_counter");
    }
  });
});
