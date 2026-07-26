"use strict";

require("./setup");

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { app } = require("../server");
const keyManager = require("../services/keyManager");
const tokenService = require("../services/tokenService");
const env = require("../config/env");

function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

function signWith({ privatePem, kid }, claims = {}) {
  return jwt.sign(
    { sub: "507f1f77bcf86cd799439011", tokenVersion: 0, jti: crypto.randomUUID(), ...claims },
    privatePem,
    {
      algorithm: "RS256",
      expiresIn: "1h",
      issuer: "workhub-identity",
      audience: "workhub-api-gateway",
      header: { kid, typ: "at+jwt" },
    },
  );
}

describe("RS256 signing keyring", () => {
  test("production refuses to boot without a persistent signing key", () => {
    expect(() =>
      keyManager.buildSigningKeyring({
        env: { IDENTITY_JWT_ACTIVE_KID: "key-1" },
        isProduction: true,
      }),
    ).toThrow(/required in production/i);
  });

  test("production requires an explicit active kid", () => {
    const { privatePem } = generateKeyPair();
    expect(() =>
      keyManager.buildSigningKeyring({
        env: { IDENTITY_JWT_PRIVATE_KEY: privatePem },
        isProduction: true,
      }),
    ).toThrow(/IDENTITY_JWT_ACTIVE_KID/);
  });

  test("dev generates an ephemeral key and flags it as such", () => {
    const ring = keyManager.buildSigningKeyring({ env: {}, isProduction: false });
    expect(ring.describe().ephemeral).toBe(true);
  });

  test("a restart with the same key material keeps existing tokens valid", () => {
    const { privatePem } = generateKeyPair();
    const config = {
      IDENTITY_JWT_PRIVATE_KEY: privatePem,
      IDENTITY_JWT_ACTIVE_KID: "key-restart",
    };

    const before = keyManager.buildSigningKeyring({ env: config, isProduction: true });
    const token = signWith({ privatePem, kid: "key-restart" });

    // Simulate a process restart: a brand new keyring from the same env.
    const after = keyManager.buildSigningKeyring({ env: config, isProduction: true });
    const key = after.getVerificationKey("key-restart");

    expect(before.getActiveKey().kid).toBe(after.getActiveKey().kid);
    expect(() =>
      jwt.verify(token, key.publicKey, {
        algorithms: ["RS256"],
        issuer: "workhub-identity",
        audience: "workhub-api-gateway",
      }),
    ).not.toThrow();
  });

  test("during rotation, tokens from the previous key still verify", () => {
    const oldKey = generateKeyPair();
    const newKey = generateKeyPair();

    const ring = keyManager.buildSigningKeyring({
      env: {
        IDENTITY_JWT_PRIVATE_KEY: newKey.privatePem,
        IDENTITY_JWT_ACTIVE_KID: "key-new",
        IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS: `key-old:${Buffer.from(oldKey.publicPem).toString("base64")}`,
      },
      isProduction: true,
    });

    const oldToken = signWith({ privatePem: oldKey.privatePem, kid: "key-old" });
    const resolved = ring.getVerificationKey("key-old");

    expect(() =>
      jwt.verify(oldToken, resolved.publicKey, {
        algorithms: ["RS256"],
        issuer: "workhub-identity",
        audience: "workhub-api-gateway",
      }),
    ).not.toThrow();
    expect(ring.getActiveKey().kid).toBe("key-new");
  });

  test("a retired kid is rejected even if its public key is still listed", () => {
    const oldKey = generateKeyPair();
    const newKey = generateKeyPair();

    const ring = keyManager.buildSigningKeyring({
      env: {
        IDENTITY_JWT_PRIVATE_KEY: newKey.privatePem,
        IDENTITY_JWT_ACTIVE_KID: "key-new",
        IDENTITY_JWT_PREVIOUS_PUBLIC_KEYS: `key-old:${Buffer.from(oldKey.publicPem).toString("base64")}`,
        IDENTITY_JWT_RETIRED_KIDS: "key-old",
      },
      isProduction: true,
    });

    expect(() => ring.getVerificationKey("key-old")).toThrow(/retired/i);
    expect(ring.getJwks().document.keys.map((k) => k.kid)).toEqual(["key-new"]);
  });

  test("an unknown kid is rejected", () => {
    const { privatePem } = generateKeyPair();
    const ring = keyManager.buildSigningKeyring({
      env: { IDENTITY_JWT_PRIVATE_KEY: privatePem, IDENTITY_JWT_ACTIVE_KID: "key-a" },
      isProduction: true,
    });

    expect(() => ring.getVerificationKey("key-does-not-exist")).toThrow(/Unknown key id/);
  });

  test("the active key must be RSA and at least 2048 bits", () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() =>
      keyManager.buildSigningKeyring({
        env: {
          IDENTITY_JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
          IDENTITY_JWT_ACTIVE_KID: "key-ec",
        },
        isProduction: true,
      }),
    ).toThrow(/must be RSA/);
  });

  test("the JWKS ETag changes when the key set changes", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();

    const ringA = keyManager.buildSigningKeyring({
      env: { IDENTITY_JWT_PRIVATE_KEY: a.privatePem, IDENTITY_JWT_ACTIVE_KID: "key-a" },
      isProduction: true,
    });
    const ringB = keyManager.buildSigningKeyring({
      env: { IDENTITY_JWT_PRIVATE_KEY: b.privatePem, IDENTITY_JWT_ACTIVE_KID: "key-b" },
      isProduction: true,
    });

    expect(ringA.getJwks().etag).not.toBe(ringB.getJwks().etag);
    // Stable across calls on the same key set.
    expect(ringA.getJwks().etag).toBe(ringA.getJwks().etag);
  });
});

describe("JWKS endpoint", () => {
  test("serves the key set with a validator and cache directives", async () => {
    const res = await request(app).get("/.well-known/jwks.json");

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers["cache-control"]).toContain("max-age");
    expect(res.body.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    expect(res.body.keys[0]).toHaveProperty("kid");
    // Public parameters only — never the private exponent.
    expect(res.body.keys[0]).not.toHaveProperty("d");
  });

  test("revalidates with 304 when the ETag matches", async () => {
    const first = await request(app).get("/.well-known/jwks.json");
    const second = await request(app)
      .get("/.well-known/jwks.json")
      .set("If-None-Match", first.headers.etag);

    expect(second.status).toBe(304);
  });
});

describe("Legacy HS256 sunset", () => {
  const originalEnabled = env.IDENTITY_LEGACY_JWT_ENABLED;
  const originalDeadline = env.IDENTITY_LEGACY_JWT_DEADLINE;

  afterEach(() => {
    env.IDENTITY_LEGACY_JWT_ENABLED = originalEnabled;
    env.IDENTITY_LEGACY_JWT_DEADLINE = originalDeadline;
  });

  function legacyToken() {
    return jwt.sign(
      { userId: "507f1f77bcf86cd799439011", role: "customer", tokenVersion: 0 },
      env.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "1h",
        issuer: "workhub-auth",
        audience: "workhub-app",
      },
    );
  }

  test("legacy tokens verify while the window is open", () => {
    env.IDENTITY_LEGACY_JWT_ENABLED = true;
    env.IDENTITY_LEGACY_JWT_DEADLINE = "";

    const claims = tokenService.verifyLegacyAccessToken(legacyToken());
    expect(claims.userId).toBe("507f1f77bcf86cd799439011");
    expect(claims.legacy).toBe(true);
  });

  test("legacy tokens are refused once the deadline passes", () => {
    env.IDENTITY_LEGACY_JWT_ENABLED = true;
    env.IDENTITY_LEGACY_JWT_DEADLINE = "2020-01-01T00:00:00.000Z";

    expect(() => tokenService.verifyLegacyAccessToken(legacyToken())).toThrow(
      /no longer accepted/i,
    );
    expect(tokenService.legacyJwtAllowed()).toBe(false);
  });

  test("legacy tokens are refused when the flag is off, deadline or not", () => {
    env.IDENTITY_LEGACY_JWT_ENABLED = false;
    env.IDENTITY_LEGACY_JWT_DEADLINE = "";

    expect(() => tokenService.verifyLegacyAccessToken(legacyToken())).toThrow(
      /no longer accepted/i,
    );
  });

  test("an HS256 token is never accepted by the RS256 validator", () => {
    expect(() => tokenService.verifyAccessToken(legacyToken())).toThrow(/must use RS256/);
  });

  test("an unsigned 'alg: none' token is rejected", () => {
    const forged = jwt.sign({ sub: "507f1f77bcf86cd799439011", tokenVersion: 0 }, "", {
      algorithm: "none",
    });

    expect(() => tokenService.verifyAccessToken(forged)).toThrow();
    expect(() => tokenService.verifyLegacyAccessToken(forged)).toThrow();
    expect(() => tokenService.verifyPreAuthToken(forged)).toThrow();
  });
});
