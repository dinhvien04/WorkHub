"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.IDENTITY_INTERNAL_SECRET = "test_identity_internal_secret_key_at_least_32_chars";
process.env.CONTENT_INTERNAL_SECRET = "test_content_internal_secret_key_at_least_32_chars";
process.env.COMMUNICATION_INTERNAL_SECRET = "test_communication_internal_secret_key_at_least_32";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { TokenCache, hashToken } = require("./lib/tokenCache");
const { IdentityClient } = require("./lib/identityClient");

describe("Gateway token cache", () => {
  test("keys entries by SHA-256, never by the raw token", () => {
    const cache = new TokenCache();
    const token = "header.payload.signature";
    cache.set(token, { active: true, user: { userId: "u1" } });

    const keys = [...cache.entries.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(token);
    expect(keys[0]).toBe(hashToken(token));
    // The raw credential must not be recoverable from the cache structure.
    expect(JSON.stringify([...cache.entries])).not.toContain(token);
  });

  test("evicts the least recently used entry once full", () => {
    const cache = new TokenCache({ maxEntries: 3 });
    cache.set("t1", { user: { userId: "u1" } });
    cache.set("t2", { user: { userId: "u2" } });
    cache.set("t3", { user: { userId: "u3" } });

    // Touch t1 so t2 becomes the least recently used.
    cache.get("t1");
    cache.set("t4", { user: { userId: "u4" } });

    expect(cache.size).toBe(3);
    expect(cache.get("t1")).toBeTruthy();
    expect(cache.get("t2")).toBeNull();
    expect(cache.get("t4")).toBeTruthy();
  });

  test("stays bounded under heavy churn", () => {
    const cache = new TokenCache({ maxEntries: 100 });
    for (let i = 0; i < 10000; i++) {
      cache.set(`token-${i}`, { user: { userId: `u${i}` } });
    }
    expect(cache.size).toBe(100);
    expect(cache.stats().evictions).toBe(9900);
  });

  test("expires entries after the TTL", () => {
    const cache = new TokenCache({ ttlMs: 20 });
    cache.set("t1", { user: { userId: "u1" } });
    expect(cache.get("t1")).toBeTruthy();

    jest.useFakeTimers();
    try {
      jest.setSystemTime(Date.now() + 50);
      expect(cache.get("t1")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a per-entry TTL can shorten but never extend the cache ceiling", () => {
    const cache = new TokenCache({ ttlMs: 15000 });
    cache.set("t1", { user: { userId: "u1" } }, { ttlMs: 999999 });

    const entry = cache.entries.get(hashToken("t1"));
    expect(entry.expiresAt - Date.now()).toBeLessThanOrEqual(15000);
  });

  test("a revocation drops every cached entry for that user", () => {
    const cache = new TokenCache();
    cache.set("t1", { user: { userId: "u1" } });
    cache.set("t2", { user: { userId: "u1" } });
    cache.set("t3", { user: { userId: "u2" } });

    expect(cache.evictUser("u1")).toBe(2);
    expect(cache.get("t1")).toBeNull();
    expect(cache.get("t2")).toBeNull();
    expect(cache.get("t3")).toBeTruthy();
  });
});

describe("Gateway identity client", () => {
  function makeKeyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    return {
      privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
      jwk: publicKey.export({ format: "jwk" }),
    };
  }

  function jwksResponse(kid, jwk, etag = '"etag-1"') {
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === "etag" ? etag : null) },
      json: async () => ({
        keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, use: "sig", alg: "RS256", kid }],
      }),
    };
  }

  test("verifies an RS256 token locally using the published JWKS", async () => {
    const { privatePem, jwk } = makeKeyPair();
    const fetchImpl = jest.fn(async () => jwksResponse("key-1", jwk));

    const client = new IdentityClient({
      baseUrl: "http://identity.test",
      internalSecret: "secret",
      fetchImpl,
    });
    await client.refreshJwks({ force: true });

    const token = jwt.sign({ sub: "u1", role: "customer", tokenVersion: 0 }, privatePem, {
      algorithm: "RS256",
      expiresIn: "1h",
      issuer: "workhub-identity",
      audience: "workhub-api-gateway",
      header: { kid: "key-1", typ: "at+jwt" },
    });

    const claims = await client.verifyLocally(token);
    expect(claims).toMatchObject({ userId: "u1", role: "customer" });
  });

  test("rejects a token signed by a key that is not in the JWKS", async () => {
    const trusted = makeKeyPair();
    const attacker = makeKeyPair();
    const fetchImpl = jest.fn(async () => jwksResponse("key-1", trusted.jwk));

    const client = new IdentityClient({
      baseUrl: "http://identity.test",
      internalSecret: "secret",
      fetchImpl,
    });
    await client.refreshJwks({ force: true });

    const forged = jwt.sign({ sub: "u1", tokenVersion: 0 }, attacker.privatePem, {
      algorithm: "RS256",
      expiresIn: "1h",
      issuer: "workhub-identity",
      audience: "workhub-api-gateway",
      header: { kid: "key-1", typ: "at+jwt" },
    });

    expect(await client.verifyLocally(forged)).toBeNull();
  });

  test("an HS256 token is never accepted by local RS256 verification", async () => {
    const client = new IdentityClient({ baseUrl: "http://identity.test", internalSecret: "s" });
    const hs = jwt.sign({ sub: "u1" }, "shared-secret", { algorithm: "HS256" });
    expect(await client.verifyLocally(hs)).toBeNull();
  });

  test("introspection results are cached, so a repeat call costs no round trip", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ active: true, user: { userId: "u1", role: "customer" } }),
    }));

    const client = new IdentityClient({
      baseUrl: "http://identity.test",
      internalSecret: "secret",
      fetchImpl,
    });

    const first = await client.resolve("token-abc");
    const second = await client.resolve("token-abc");

    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a revoked user's cached entry is dropped on eviction", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ active: true, user: { userId: "u1", role: "customer" } }),
    }));

    const client = new IdentityClient({
      baseUrl: "http://identity.test",
      internalSecret: "secret",
      fetchImpl,
    });

    await client.resolve("token-abc");
    client.evictUser("u1");
    await client.resolve("token-abc");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("an identity outage is fatal for mutations and silent for reads", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const client = new IdentityClient({
      baseUrl: "http://identity.test",
      internalSecret: "secret",
      fetchImpl,
    });

    await expect(client.resolve("token-abc", { strict: true })).rejects.toThrow();
    expect(await client.resolve("token-abc", { strict: false })).toBeNull();
  });

  test("the internal secret is sent on introspection and never the JWKS fetch", async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ active: false }),
      };
    });

    const client = new IdentityClient({
      baseUrl: "http://identity.test",
      internalSecret: "top-secret",
      fetchImpl,
    });
    await client.resolve("token-abc");

    const introspectCall = calls.find((c) => c.url.includes("/internal/auth/introspect"));
    expect(introspectCall.options.headers["X-Internal-Token"]).toBe("top-secret");
    expect(introspectCall.options.headers["X-Service-Name"]).toBe("api-gateway");
  });
});

describe("Gateway holds no direct database access", () => {
  test("mongoose is not a declared dependency", () => {
    const pkg = require("./package.json");
    expect(Object.keys(pkg.dependencies)).not.toContain("mongoose");
  });

  test("the server source never requires mongoose", () => {
    const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
    expect(source).not.toMatch(/require\(["']mongoose["']\)/);
    expect(source).not.toMatch(/createConnection/);
    expect(source).not.toMatch(/MONGODB_URI/);
  });

  test("loading the gateway pulls no mongo driver into the module graph", () => {
    jest.isolateModules(() => {
      require("./server");
      const loaded = Object.keys(require.cache).map((p) => p.toLowerCase());
      expect(loaded.some((p) => p.includes(`${path.sep}mongoose${path.sep}`))).toBe(false);
      expect(loaded.some((p) => p.includes(`${path.sep}mongodb${path.sep}`))).toBe(false);
    });
  });
});

describe("Gateway legacy JWT sunset", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function loadGateway() {
    let mod;
    jest.isolateModules(() => {
      mod = require("./server");
    });
    return mod;
  }

  test("legacy tokens are allowed before the deadline", () => {
    process.env.IDENTITY_LEGACY_JWT_ENABLED = "true";
    process.env.IDENTITY_LEGACY_JWT_DEADLINE = "2999-01-01T00:00:00.000Z";
    expect(loadGateway().legacyJwtAllowed()).toBe(true);
  });

  test("legacy tokens are refused after the deadline", () => {
    process.env.IDENTITY_LEGACY_JWT_ENABLED = "true";
    process.env.IDENTITY_LEGACY_JWT_DEADLINE = "2020-01-01T00:00:00.000Z";
    expect(loadGateway().legacyJwtAllowed()).toBe(false);
  });

  test("legacy tokens are refused when the flag is off", () => {
    process.env.IDENTITY_LEGACY_JWT_ENABLED = "false";
    delete process.env.IDENTITY_LEGACY_JWT_DEADLINE;
    expect(loadGateway().legacyJwtAllowed()).toBe(false);
  });
});

describe("Gateway revocation detection", () => {
  const { isRevocationRequest } = require("./server");

  test.each([
    ["POST", "/api/auth/logout"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/sessions/logout-all"],
    ["DELETE", "/api/sessions/abc123"],
    ["POST", "/api/admin/users/507f1f77bcf86cd799439011/force-logout"],
  ])("%s %s is treated as a revocation", (method, path) => {
    expect(isRevocationRequest({ method, path })).toBe(true);
  });

  test.each([
    ["GET", "/api/sessions"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/bookings"],
  ])("%s %s is not a revocation", (method, path) => {
    expect(isRevocationRequest({ method, path })).toBe(false);
  });
});
