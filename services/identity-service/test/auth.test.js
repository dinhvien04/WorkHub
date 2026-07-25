"use strict";

require("./setup");

const request = require("supertest");
const { app } = require("../server");
const User = require("../models/User");
const UserSession = require("../models/Session");
const PasswordResetToken = require("../models/PasswordResetToken");
const EmailVerificationToken = require("../models/EmailVerificationToken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

describe("Identity Service full auth contract", () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await UserSession.deleteMany({});
    await PasswordResetToken.deleteMany({});
    await EmailVerificationToken.deleteMany({});
  });

  test("register + login + me preserves cookie/session contract", async () => {
    const registerRes = await request(app).post("/api/auth/register").send({
      email: "user@example.com",
      password: "password12345",
      fullName: "Test User",
      role: "customer",
      phone: "0900000000",
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user.email).toBe("user@example.com");

    // Customer starts inactive until email verify in full flow.
    // Activate for login path coverage if register left inactive.
    await User.updateOne(
      { Email: "user@example.com" },
      { $set: { Status: "active", EmailVerified: true } },
    );

    const loginRes = await request(app).post("/api/auth/login").send({
      email: "user@example.com",
      password: "password12345",
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2fa).toBe(false);
    expect(loginRes.headers["set-cookie"]).toBeDefined();

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", loginRes.headers["set-cookie"]);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("user@example.com");
  });

  test("invalid login credentials return 401", async () => {
    await User.create({
      Email: "user2@example.com",
      PasswordHash: await bcrypt.hash("password12345", 10),
      FullName: "User Two",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
      AuthProvider: "local",
    });
    const res = await request(app).post("/api/auth/login").send({
      email: "user2@example.com",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
  });

  test("2FA login challenge is required when TotpEnabled", async () => {
    const totpService = require("../services/totpService");
    const secret = totpService.generateSecret();
    await User.create({
      Email: "twofa@example.com",
      PasswordHash: await bcrypt.hash("password12345", 10),
      FullName: "Two FA",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
      AuthProvider: "local",
      TotpEnabled: true,
      TotpSecret: secret,
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      email: "twofa@example.com",
      password: "password12345",
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2fa).toBe(true);
    expect(loginRes.body.pendingToken).toBeTruthy();
  });

  test("forgot/reset password flow invalidates sessions", async () => {
    const user = await User.create({
      Email: "reset@example.com",
      PasswordHash: await bcrypt.hash("password12345", 10),
      FullName: "Reset User",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
      AuthProvider: "local",
      tokenVersion: 0,
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      email: "reset@example.com",
      password: "password12345",
    });
    expect(loginRes.status).toBe(200);

    const forgotRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "reset@example.com" });
    expect(forgotRes.status).toBe(200);

    // Recover OTP from DB token hash by creating known token for test assert path.
    const otp = "123456";
    const tokenHash = crypto.createHash("sha256").update(otp).digest("hex");
    await PasswordResetToken.deleteMany({ Email: "reset@example.com" });
    await PasswordResetToken.create({
      UserID: user._id,
      Email: "reset@example.com",
      TokenHash: tokenHash,
      Attempts: 0,
      MaxAttempts: 5,
      ExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const resetRes = await request(app).post("/api/auth/reset-password").send({
      email: "reset@example.com",
      otp,
      newPassword: "newpassword123",
    });
    expect(resetRes.status).toBe(200);

    const oldMe = await request(app)
      .get("/api/auth/me")
      .set("Cookie", loginRes.headers["set-cookie"]);
    expect(oldMe.status).toBe(401);

    const relogin = await request(app).post("/api/auth/login").send({
      email: "reset@example.com",
      password: "newpassword123",
    });
    expect(relogin.status).toBe(200);
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
    });
    const raw = crypto.randomBytes(16).toString("hex");
    const TokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    await EmailVerificationToken.create({
      UserID: user._id,
      TokenHash,
      ExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    const confirmRes = await request(app)
      .post("/api/auth/email/confirm")
      .send({ token: raw });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.verified).toBe(true);

    const updated = await User.findById(user._id).lean();
    expect(updated.EmailVerified).toBe(true);
    expect(updated.Status).toBe("active");
  });

  test("logout-all revokes sessions and bumps tokenVersion", async () => {
    await User.create({
      Email: "user3@example.com",
      PasswordHash: await bcrypt.hash("password12345", 10),
      FullName: "User Three",
      Role: "customer",
      Status: "active",
      EmailVerified: true,
      AuthProvider: "local",
      tokenVersion: 0,
    });
    const loginRes = await request(app).post("/api/auth/login").send({
      email: "user3@example.com",
      password: "password12345",
    });
    expect(loginRes.status).toBe(200);

    const logoutAllRes = await request(app)
      .post("/api/sessions/logout-all")
      .set("Cookie", loginRes.headers["set-cookie"]);
    expect(logoutAllRes.status).toBe(200);

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", loginRes.headers["set-cookie"]);
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
});
