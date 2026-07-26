"use strict";

require("./setup");

const request = require("supertest");
const { app } = require("../server");
const User = require("../models/User");
const UserSession = require("../models/Session");
const PasswordResetToken = require("../models/PasswordResetToken");
const PendingAuthToken = require("../models/PendingAuthToken");
const IdentityOutbox = require("../models/IdentityOutbox");
const totpService = require("../services/totpService");
const tokenService = require("../services/tokenService");
const keyring = require("../services/keyring");
const { createUser, login, mutate, ORIGIN } = require("./helpers");

const PASSWORD = "password12345";

async function enableTotpFor(email) {
  const user = await createUser({ Email: email });
  const session = await login(app, { email, password: PASSWORD });

  const setupRes = await mutate(app, "post", "/api/auth/2fa/setup", session);
  expect(setupRes.status).toBe(200);
  const secret = setupRes.body.secret;

  const enableRes = await mutate(app, "post", "/api/auth/2fa/enable", session).send({
    code: totpService.totpAt(secret),
  });
  expect(enableRes.status).toBe(200);

  return { user, session, secret, recoveryCodes: enableRes.body.recoveryCodes };
}

describe("TOTP encryption keyring", () => {
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserSession.deleteMany({}), PendingAuthToken.deleteMany({})]);
    keyring.resetKeyrings();
  });

  afterEach(() => {
    process.env.IDENTITY_TOTP_ENCRYPTION_KEY = "1".repeat(64);
    process.env.IDENTITY_TOTP_KEY_VERSION = "v1";
    delete process.env.IDENTITY_TOTP_PREVIOUS_KEYS;
    keyring.resetKeyrings();
  });

  test("full login with an encrypted TOTP seed succeeds", async () => {
    const { secret } = await enableTotpFor("totp-login@example.com");

    // The seed must be ciphertext at rest, not the base32 secret.
    const stored = await User.findOne({ Email: "totp-login@example.com" })
      .select("+TotpSecret")
      .lean();
    expect(stored.TotpSecret).not.toBe(secret);
    expect(stored.TotpSecret.startsWith("v1:")).toBe(true);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "totp-login@example.com", password: PASSWORD });
    expect(loginRes.body.requires2fa).toBe(true);

    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Origin", ORIGIN)
      .send({ pendingToken: loginRes.body.pendingToken, code: totpService.totpAt(secret) });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.headers["set-cookie"].join(";")).toContain("authToken=");
  });

  test("a wrong encryption key fails closed instead of authenticating", async () => {
    const { secret } = await enableTotpFor("totp-wrongkey@example.com");

    // Same version label, different key material — GCM authentication fails.
    process.env.IDENTITY_TOTP_ENCRYPTION_KEY = "9".repeat(64);
    keyring.resetKeyrings();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "totp-wrongkey@example.com", password: PASSWORD });

    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Origin", ORIGIN)
      .send({ pendingToken: loginRes.body.pendingToken, code: totpService.totpAt(secret) });

    expect(verifyRes.status).toBe(401);
    // A CSRF cookie is always refreshed; what must never appear is a session.
    expect([].concat(verifyRes.headers["set-cookie"] || []).join(";")).not.toContain(
      "authToken=",
    );
  });

  test("an unknown key version is rejected, not treated as plaintext", async () => {
    const encrypted = totpService.encryptSecret("JBSWY3DPEHPK3PXP", "user-1");
    const foreign = encrypted.replace(/^v1:/, "v7:");

    expect(() => totpService.decryptSecret(foreign, "user-1")).toThrow(/No key registered/);
    expect(totpService.tryDecryptSecret(foreign, "user-1").ok).toBe(false);
  });

  test("malformed ciphertext is rejected rather than returned as the secret", () => {
    expect(() => totpService.decryptSecret("not-ciphertext", "user-1")).toThrow();
    expect(() => totpService.decryptSecret("v1:zz:zz:zz", "user-1")).toThrow(/Malformed/);
  });

  test("rotation re-encrypts under the new key while old rows still decrypt", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const underV1 = totpService.encryptSecret(secret, "user-42");
    expect(underV1.startsWith("v1:")).toBe(true);

    // Promote v2, keep v1 available for decryption.
    process.env.IDENTITY_TOTP_ENCRYPTION_KEY = "3".repeat(64);
    process.env.IDENTITY_TOTP_KEY_VERSION = "v2";
    process.env.IDENTITY_TOTP_PREVIOUS_KEYS = `v1:${"1".repeat(64)}`;
    keyring.resetKeyrings();

    // Old ciphertext still readable during the overlap.
    expect(totpService.decryptSecret(underV1, "user-42")).toBe(secret);
    expect(totpService.needsRotation(underV1)).toBe(true);

    // Re-encrypting moves it onto the active key.
    const underV2 = totpService.encryptSecret(secret, "user-42");
    expect(underV2.startsWith("v2:")).toBe(true);
    expect(totpService.needsRotation(underV2)).toBe(false);
    expect(totpService.decryptSecret(underV2, "user-42")).toBe(secret);
  });
});

describe("Pre-auth 2FA token", () => {
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserSession.deleteMany({}), PendingAuthToken.deleteMany({})]);
  });

  test("a pending token cannot be replayed after it is spent", async () => {
    const { secret } = await enableTotpFor("replay@example.com");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "replay@example.com", password: PASSWORD });
    const pendingToken = loginRes.body.pendingToken;

    const first = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Origin", ORIGIN)
      .send({ pendingToken, code: totpService.totpAt(secret) });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Origin", ORIGIN)
      .send({ pendingToken, code: totpService.totpAt(secret) });
    expect(replay.status).toBe(401);
  });

  test("an access token cannot be presented as a pre-auth token", async () => {
    const user = await createUser({ Email: "crosstype@example.com" });
    const accessToken = tokenService.signAccessToken(user, { sid: "abc" });

    expect(() => tokenService.verifyPreAuthToken(accessToken)).toThrow();
  });

  test("a pre-auth token cannot be presented as an access token", async () => {
    const user = await createUser({ Email: "crosstype2@example.com" });
    const { token } = await tokenService.issuePreAuthToken(user);

    expect(() => tokenService.verifyAccessToken(token)).toThrow();
  });

  test("a pre-auth token issued before a password change is refused", async () => {
    const { user, secret } = await enableTotpFor("stale-preauth@example.com");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "stale-preauth@example.com", password: PASSWORD });

    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });

    const res = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Origin", ORIGIN)
      .send({ pendingToken: loginRes.body.pendingToken, code: totpService.totpAt(secret) });
    expect(res.status).toBe(401);
  });

  test("concurrent redemptions of one recovery code let exactly one through", async () => {
    const { user, recoveryCodes } = await enableTotpFor("recovery-race@example.com");
    const code = recoveryCodes[0];

    // Each attempt needs its own pending token, since that is single-use too.
    const fresh = await User.findById(user._id);
    const tokens = await Promise.all([
      tokenService.issuePreAuthToken(fresh),
      tokenService.issuePreAuthToken(fresh),
      tokenService.issuePreAuthToken(fresh),
    ]);

    const results = await Promise.all(
      tokens.map((t) =>
        request(app)
          .post("/api/auth/2fa/verify")
          .set("Origin", ORIGIN)
          .send({ pendingToken: t.token, code }),
      ),
    );

    const accepted = results.filter((r) => r.status === 200);
    expect(accepted).toHaveLength(1);

    const after = await User.findById(user._id).select("+TotpRecoveryHashes").lean();
    expect(after.TotpRecoveryHashes).toHaveLength(recoveryCodes.length - 1);
  });
});

describe("Password verification across hash algorithms", () => {
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserSession.deleteMany({}), PendingAuthToken.deleteMany({})]);
  });

  test("disable-2FA accepts an Argon2id password", async () => {
    const { session, secret, user } = await enableTotpFor("argon-disable@example.com");

    const stored = await User.findById(user._id).select("PasswordHash").lean();
    expect(stored.PasswordHash.startsWith("$argon2")).toBe(true);

    const res = await mutate(app, "post", "/api/auth/2fa/disable", session).send({
      password: PASSWORD,
      code: totpService.totpAt(secret),
    });
    expect(res.status).toBe(200);

    const after = await User.findById(user._id).select("+TotpSecret TotpEnabled").lean();
    expect(after.TotpEnabled).toBe(false);
    expect(after.TotpSecret).toBeNull();
  });

  test("disable-2FA rejects a wrong password even with a valid TOTP code", async () => {
    const { session, secret } = await enableTotpFor("argon-disable2@example.com");

    const res = await mutate(app, "post", "/api/auth/2fa/disable", session).send({
      password: "definitely-not-the-password",
      code: totpService.totpAt(secret),
    });
    expect(res.status).toBe(401);
  });

  test("a legacy bcrypt password still logs in and is upgraded to Argon2id", async () => {
    const bcrypt = require("bcryptjs");
    await createUser({
      Email: "legacy-hash@example.com",
      PasswordHash: await bcrypt.hash(PASSWORD, 10),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "legacy-hash@example.com", password: PASSWORD });
    expect(res.status).toBe(200);

    const after = await User.findOne({ Email: "legacy-hash@example.com" })
      .select("PasswordHash")
      .lean();
    expect(after.PasswordHash.startsWith("$argon2")).toBe(true);
  });
});

describe("Password reset concurrency", () => {
  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      UserSession.deleteMany({}),
      PasswordResetToken.deleteMany({}),
      IdentityOutbox.deleteMany({}),
    ]);
  });

  test("the reset OTP is stored as a peppered HMAC, not a bare SHA-256", async () => {
    const crypto = require("crypto");
    await createUser({ Email: "pepper@example.com" });

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", ORIGIN)
      .send({ email: "pepper@example.com" });

    const otp = forgot.body.devOtp;
    const record = await PasswordResetToken.findOne({ Email: "pepper@example.com" }).lean();

    const bareSha = crypto.createHash("sha256").update(otp).digest("hex");
    expect(record.TokenHash).not.toBe(bareSha);
    expect(record.TokenHash).toBe(
      crypto
        .createHmac("sha256", process.env.PASSWORD_RESET_PEPPER)
        .update(otp)
        .digest("hex"),
    );
  });

  test("concurrent resets with the same OTP let exactly one succeed", async () => {
    await createUser({ Email: "reset-race@example.com" });

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", ORIGIN)
      .send({ email: "reset-race@example.com" });
    const otp = forgot.body.devOtp;

    const attempts = await Promise.all(
      ["newpassword-aaa1", "newpassword-bbb2", "newpassword-ccc3"].map((newPassword) =>
        request(app)
          .post("/api/auth/reset-password")
          .set("Origin", ORIGIN)
          .send({ email: "reset-race@example.com", otp, newPassword }),
      ),
    );

    const succeeded = attempts.filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(1);

    const record = await PasswordResetToken.findOne({ Email: "reset-race@example.com" }).lean();
    expect(record.UsedAt).not.toBeNull();
  });

  test("forgot-password enqueues the OTP mail instead of calling a provider", async () => {
    await createUser({ Email: "reset-outbox@example.com" });

    await request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", ORIGIN)
      .send({ email: "reset-outbox@example.com" });

    const rows = await IdentityOutbox.find({ EventType: "identity.email-requested.v1" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].CipherPayload).toBeTruthy();
    expect(rows[0].Payload).toBeNull();
  });
});

describe("CSRF protection", () => {
  let session;

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserSession.deleteMany({})]);
    await createUser({ Email: "csrf@example.com" });
    session = await login(app, { email: "csrf@example.com", password: PASSWORD });
  });

  test("GET /api/auth/csrf issues a token and cookie", async () => {
    const res = await request(app).get("/api/auth/csrf");
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeTruthy();
    expect(res.headers["set-cookie"].join(";")).toContain("csrfToken=");
  });

  test("a cookie-authenticated mutation without a CSRF token is rejected", async () => {
    const res = await request(app)
      .post("/api/sessions/logout-all")
      .set("Origin", ORIGIN)
      .set("Cookie", `authToken=${session.authToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toMatch(/^CSRF_/);
  });

  test("a mismatched CSRF token is rejected", async () => {
    const res = await request(app)
      .post("/api/sessions/logout-all")
      .set("Origin", ORIGIN)
      .set("Cookie", session.cookies.join("; "))
      .set("X-CSRF-Token", "some-other-token");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_TOKEN_MISMATCH");
  });

  test("a forged CSRF token that matches the cookie is still rejected", async () => {
    const forged = "attacker-nonce.attacker-signature";
    const res = await request(app)
      .post("/api/sessions/logout-all")
      .set("Origin", ORIGIN)
      .set("Cookie", `authToken=${session.authToken}; csrfToken=${forged}`)
      .set("X-CSRF-Token", forged);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_TOKEN_INVALID");
  });

  test("a disallowed Origin is rejected", async () => {
    const res = await request(app)
      .post("/api/sessions/logout-all")
      .set("Origin", "https://evil.example.com")
      .set("Cookie", session.cookies.join("; "))
      .set("X-CSRF-Token", session.csrfToken);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_REJECTED");
  });

  test("Sec-Fetch-Site: cross-site is rejected", async () => {
    const res = await request(app)
      .post("/api/sessions/logout-all")
      .set("Origin", ORIGIN)
      .set("Sec-Fetch-Site", "cross-site")
      .set("Cookie", session.cookies.join("; "))
      .set("X-CSRF-Token", session.csrfToken);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_CROSS_SITE");
  });

  test("a well-formed same-origin mutation passes", async () => {
    const res = await mutate(app, "post", "/api/sessions/logout-all", session).set(
      "Sec-Fetch-Site",
      "same-origin",
    );
    expect(res.status).toBe(200);
  });

  test("internal service-to-service endpoints are not blocked by CSRF", async () => {
    // These authenticate with the internal secret rather than a cookie. Putting
    // them behind CSRF broke every gateway introspection call with a 403.
    const res = await request(app)
      .post("/internal/auth/introspect")
      .set("X-Internal-Token", process.env.IDENTITY_INTERNAL_SECRET)
      .set("X-Service-Name", "api-gateway")
      .send({ token: "not-a-real-token" });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  test("internal endpoints still reject a wrong internal secret", async () => {
    const res = await request(app)
      .post("/internal/auth/introspect")
      .set("X-Internal-Token", "wrong-secret")
      .set("X-Service-Name", "api-gateway")
      .send({ token: "whatever" });

    expect(res.status).toBe(401);
  });

  test("login and register stay reachable without a CSRF token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "csrf@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe("Host registration boundary", () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  test("direct host registration is refused while onboarding lives in the facade", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", ORIGIN)
      .send({
        email: "host@example.com",
        password: "password12345",
        fullName: "Host User",
        role: "host",
        phone: "0900000000",
      });

    expect(res.status).toBe(403);
    expect(await User.countDocuments({ Email: "host@example.com" })).toBe(0);
  });

  test("customer registration is unaffected", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", ORIGIN)
      .send({
        email: "customer@example.com",
        password: "password12345",
        fullName: "Customer User",
        role: "customer",
        phone: "0900000000",
      });

    expect(res.status).toBe(201);
  });
});
