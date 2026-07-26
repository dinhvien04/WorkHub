"use strict";

require("./setup");

const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../server");
const User = require("../models/User");
const UserSession = require("../models/Session");
const PasswordResetToken = require("../models/PasswordResetToken");
const EmailVerificationToken = require("../models/EmailVerificationToken");
const PendingAuthToken = require("../models/PendingAuthToken");
const IdentityOutbox = require("../models/IdentityOutbox");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { createUser, login, mutate, ORIGIN } = require("./helpers");

describe("Identity Service full auth contract", () => {
  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      UserSession.deleteMany({}),
      PasswordResetToken.deleteMany({}),
      EmailVerificationToken.deleteMany({}),
      PendingAuthToken.deleteMany({}),
      IdentityOutbox.deleteMany({}),
    ]);
  });

  test("Argon2id password hashing benchmark execution timing", async () => {
    const argon2 = require("argon2");
    const password = "my-secure-passphrase-12345";

    const startHash = Date.now();
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    expect(Date.now() - startHash).toBeLessThan(1000);

    const startVerify = Date.now();
    expect(await argon2.verify(hash, password)).toBe(true);
    expect(Date.now() - startVerify).toBeLessThan(1000);
  });

  test("register + login + me preserves cookie/session contract", async () => {
    const registerRes = await request(app)
      .post("/api/auth/register")
      .set("Origin", ORIGIN)
      .send({
        email: "user@example.com",
        password: "password12345",
        fullName: "Test User",
        role: "customer",
        phone: "0900000000",
      });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user.email).toBe("user@example.com");

    // Customers start inactive until email verification.
    await User.updateOne(
      { Email: "user@example.com" },
      { $set: { Status: "active", EmailVerified: true } },
    );

    const session = await login(app, {
      email: "user@example.com",
      password: "password12345",
    });
    expect(session.res.status).toBe(200);
    expect(session.authToken).toBeTruthy();

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", session.cookies.join("; "));
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("user@example.com");
  });

  test("registration enqueues user-created and verification email in the outbox", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", ORIGIN)
      .send({
        email: "outbox@example.com",
        password: "password12345",
        fullName: "Outbox User",
        role: "customer",
        phone: "0900000000",
      });
    expect(res.status).toBe(201);

    const rows = await IdentityOutbox.find({}).lean();
    const types = rows.map((r) => r.EventType).sort();
    expect(types).toEqual([
      "identity.email-requested.v1",
      "identity.user-created.v1",
    ]);

    // The verification token must not sit in the outbox as plaintext.
    const emailRow = rows.find((r) => r.EventType === "identity.email-requested.v1");
    expect(emailRow.Payload).toBeNull();
    expect(emailRow.CipherPayload).toEqual(expect.stringMatching(/^v1:[0-9a-f]+:[0-9a-f]+:/));
    expect(emailRow.CipherPayload).not.toContain(res.body.devToken);
  });

  test("invalid login credentials return 401", async () => {
    await createUser({ Email: "user2@example.com" });

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "user2@example.com", password: "wrong-password-here" });
    expect(res.status).toBe(401);
  });

  test("2FA login challenge is required when TotpEnabled", async () => {
    await createUser({ Email: "twofa@example.com", TotpEnabled: true });

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "twofa@example.com", password: "password12345" });

    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body.pendingToken).toBeTruthy();
    // No session cookie may be issued before the second factor.
    expect(res.headers["set-cookie"] || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining("authToken=")]),
    );
  });

  test("forgot/reset password flow invalidates sessions", async () => {
    await createUser({ Email: "reset@example.com" });

    const session = await login(app, {
      email: "reset@example.com",
      password: "password12345",
    });
    expect(session.res.status).toBe(200);

    const forgotRes = await request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", ORIGIN)
      .send({ email: "reset@example.com" });
    expect(forgotRes.status).toBe(200);
    expect(forgotRes.body.devOtp).toMatch(/^\d{6}$/);

    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .set("Origin", ORIGIN)
      .send({
        email: "reset@example.com",
        otp: forgotRes.body.devOtp,
        newPassword: "newpassword123",
      });
    expect(resetRes.status).toBe(200);

    const oldMe = await request(app)
      .get("/api/auth/me")
      .set("Cookie", session.cookies.join("; "));
    expect(oldMe.status).toBe(401);

    const relogin = await request(app)
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: "reset@example.com", password: "newpassword123" });
    expect(relogin.status).toBe(200);
  });

  test("reset password rejects a wrong OTP and burns an attempt", async () => {
    await createUser({ Email: "otpfail@example.com" });

    const forgotRes = await request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", ORIGIN)
      .send({ email: "otpfail@example.com" });

    const wrong = forgotRes.body.devOtp === "000000" ? "111111" : "000000";
    const res = await request(app)
      .post("/api/auth/reset-password")
      .set("Origin", ORIGIN)
      .send({ email: "otpfail@example.com", otp: wrong, newPassword: "newpassword123" });
    expect(res.status).toBe(400);

    const record = await PasswordResetToken.findOne({ Email: "otpfail@example.com" }).lean();
    expect(record.Attempts).toBe(1);
    expect(record.UsedAt).toBeNull();
  });

  test("email verification confirm activates customer", async () => {
    const user = await User.create({
      Email: "verify@example.com",
      PasswordHash: await bcrypt.hash("password12345", 10),
      FullName: "Verify User",
      Role: "customer",
      Status: "inactive",
      EmailVerified: false,
      AuthProvider: "local",
      tokenVersion: 0,
    });

    const raw = crypto.randomBytes(32).toString("hex");
    await EmailVerificationToken.create({
      UserID: user._id,
      TokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      ExpiresAt: new Date(Date.now() + 3600000),
    });

    const confirmRes = await request(app)
      .post("/api/auth/email/confirm")
      .set("Origin", ORIGIN)
      .send({ token: raw });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.verified).toBe(true);

    const updated = await User.findById(user._id).lean();
    expect(updated.EmailVerified).toBe(true);
    expect(updated.Status).toBe("active");
  });

  test("logout-all revokes sessions and bumps tokenVersion", async () => {
    await createUser({ Email: "user3@example.com" });

    const session = await login(app, {
      email: "user3@example.com",
      password: "password12345",
    });
    expect(session.res.status).toBe(200);

    const logoutAllRes = await mutate(app, "post", "/api/sessions/logout-all", session);
    expect(logoutAllRes.status).toBe(200);

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", session.cookies.join("; "));
    expect(meRes.status).toBe(401);

    const user = await User.findOne({ Email: "user3@example.com" }).lean();
    expect(user.tokenVersion).toBe(1);
  });

  test("google status endpoint reports mock/config state", async () => {
    const res = await request(app).get("/api/auth/google/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("configured");
    expect(res.body).toHaveProperty("mockAllowed");
  });

  test("admin force logout revokes sessions and bumps tokenVersion", async () => {
    await createUser({ Email: "admin@example.com", Role: "admin", FullName: "Admin User" });
    const victim = await createUser({ Email: "victim@example.com", FullName: "Victim User" });

    const adminSession = await login(app, {
      email: "admin@example.com",
      password: "password12345",
    });
    const victimSession = await login(app, {
      email: "victim@example.com",
      password: "password12345",
    });

    const failRes = await mutate(
      app,
      "post",
      `/api/admin/users/${victim._id}/force-logout`,
      victimSession,
    );
    expect(failRes.status).toBe(403);

    const successRes = await mutate(
      app,
      "post",
      `/api/admin/users/${victim._id}/force-logout`,
      adminSession,
    );
    expect(successRes.status).toBe(200);

    const updatedUser = await User.findById(victim._id).lean();
    expect(updatedUser.tokenVersion).toBe(1);

    const openSessions = await UserSession.countDocuments({
      UserID: victim._id,
      RevokedAt: null,
    });
    expect(openSessions).toBe(0);
  });

  test("TOTP secret is encrypted at rest using AES-256-GCM and bound to userId", async () => {
    const totpService = require("../services/totpService");
    const userId = new mongoose.Types.ObjectId();
    const secret = totpService.generateSecret();

    const encrypted = totpService.encryptSecret(secret, userId);
    expect(encrypted).not.toBe(secret);
    expect(encrypted).toContain("v1:");
    expect(totpService.decryptSecret(encrypted, userId)).toBe(secret);

    // A different userId is a different AAD — the GCM tag must not authenticate.
    const otherUserId = new mongoose.Types.ObjectId();
    expect(() => totpService.decryptSecret(encrypted, otherUserId)).toThrow();
  });
});
