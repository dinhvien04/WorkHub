"use strict";

require("./setup");

const request = require("supertest");
const { app } = require("../server");
const User = require("../models/User");
const UserSession = require("../models/Session");

describe("Identity Service auth contract", () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await UserSession.deleteMany({});
  });

  test("register + login + me preserves cookie/session contract", async () => {
    const registerRes = await request(app).post("/api/auth/register").send({
      email: "user@example.com",
      password: "password12345",
      fullName: "Test User",
      role: "customer",
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user.email).toBe("user@example.com");

    const loginRes = await request(app).post("/api/auth/login").send({
      email: "user@example.com",
      password: "password12345",
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.headers["set-cookie"]).toBeDefined();

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("user@example.com");
    expect(meRes.body.user.role).toBe("customer");

    const sessionsRes = await request(app)
      .get("/api/sessions")
      .set("Authorization", `Bearer ${loginRes.body.token}`);
    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.body.sessions.length).toBe(1);
  });

  test("invalid login credentials return 401", async () => {
    await request(app).post("/api/auth/register").send({
      email: "user2@example.com",
      password: "password12345",
      fullName: "User Two",
    });
    const res = await request(app).post("/api/auth/login").send({
      email: "user2@example.com",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
  });

  test("logout-all revokes sessions and invalidates tokenVersion", async () => {
    await request(app).post("/api/auth/register").send({
      email: "user3@example.com",
      password: "password12345",
      fullName: "User Three",
    });
    const loginRes = await request(app).post("/api/auth/login").send({
      email: "user3@example.com",
      password: "password12345",
    });
    const token = loginRes.body.token;

    const logoutAllRes = await request(app)
      .post("/api/sessions/logout-all")
      .set("Authorization", `Bearer ${token}`);
    expect(logoutAllRes.status).toBe(200);

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(401);

    const user = await User.findOne({ Email: "user3@example.com" }).lean();
    expect(user.tokenVersion).toBe(1);
    const openSessions = await UserSession.countDocuments({
      UserID: user._id,
      RevokedAt: null,
    });
    expect(openSessions).toBe(0);
  });
});
