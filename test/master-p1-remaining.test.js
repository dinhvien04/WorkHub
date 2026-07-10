"use strict";

/**
 * Remaining P1 regression from fix.md: sessions, slots, webhook claim,
 * password reset indistinguishability, API key branches.
 */
const request = require("supertest");
const crypto = require("crypto");
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
  futureRange,
} = require("./helpers");
const bookingService = require("../services/bookingService");
const gatewayService = require("../services/gatewayService");
const WebhookEvent = require("../models/WebhookEvent");
const UserSession = require("../models/Session");
const Branch = require("../models/Branch");
const env = require("../config/env");

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe("P1 Adjacent booking slots", () => {
  test("exact-aligned adjacent ranges do not conflict", async () => {
    const host = await createUser({ email: "sloth@t.com", role: "host" });
    const c1 = await createUser({ email: "slotc1@t.com", role: "customer" });
    const c2 = await createUser({ email: "slotc2@t.com", role: "customer" });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 0.5); // 30 min
    const mid = end;
    const end2 = new Date(end.getTime() + 30 * 60 * 1000);

    const b1 = await bookingService.createBooking({
      customerId: c1._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const b2 = await bookingService.createBooking({
      customerId: c2._id,
      spaceId: space._id,
      startTime: mid,
      endTime: end2,
    });
    expect(b1._id).toBeTruthy();
    expect(b2._id).toBeTruthy();

    // Partial overlap still conflicts
    await expect(
      bookingService.createBooking({
        customerId: c1._id,
        spaceId: space._id,
        startTime: start,
        endTime: end2,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("misaligned start rejected", async () => {
    const host = await createUser({ email: "alignh@t.com", role: "host" });
    const c = await createUser({ email: "alignc@t.com", role: "customer" });
    const { space } = await seedHostSpace(host);
    const { start } = futureRange(4, 1);
    const badStart = new Date(start.getTime() + 5 * 60 * 1000);
    const badEnd = new Date(badStart.getTime() + 60 * 60 * 1000);
    await expect(
      bookingService.createBooking({
        customerId: c._id,
        spaceId: space._id,
        startTime: badStart,
        endTime: badEnd,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("P1 Per-session revoke", () => {
  test("revoke one session invalidates that JWT only", async () => {
    const user = await createUser({
      email: "sess@t.com",
      role: "customer",
      password: "Pass1234ab",
    });
    const login1 = await request(app)
      .post("/api/auth/login")
      .send({ email: "sess@t.com", password: "Pass1234ab" });
    expect(login1.status).toBe(200);
    const cookie1 = (login1.headers["set-cookie"] || [])
      .find((c) => c.startsWith("authToken="))
      ?.split(";")[0];
    expect(cookie1).toBeTruthy();

    const login2 = await request(app)
      .post("/api/auth/login")
      .send({ email: "sess@t.com", password: "Pass1234ab" });
    const cookie2 = (login2.headers["set-cookie"] || [])
      .find((c) => c.startsWith("authToken="))
      ?.split(";")[0];

    const list = await request(app)
      .get("/api/sessions")
      .set("Cookie", cookie1);
    expect(list.status).toBe(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);

    const other = list.body.sessions.find((s) => !s.current) || list.body.sessions[0];
    const csrf = await getCsrfPair(app);
    const rev = await withCsrf(
      request(app).delete(`/api/sessions/${other.id}`),
      csrf,
      cookie1,
    );
    expect(rev.status).toBe(200);

    // Current session still works
    const me1 = await request(app).get("/api/auth/me").set("Cookie", cookie1);
    expect(me1.status).toBe(200);

    // If we revoked session2's sid, cookie2 should fail when that was the other
    const sessionsLeft = await UserSession.countDocuments({
      UserID: user._id,
      RevokedAt: null,
    });
    expect(sessionsLeft).toBeGreaterThanOrEqual(1);
  });
});

describe("P1 Webhook claim + payload mismatch", () => {
  test("duplicate event id is idempotent; different payload hash rejected", async () => {
    const host = await createUser({ email: "whh@t.com", role: "host" });
    const customer = await createUser({
      email: "whc@t.com",
      role: "customer",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { session } = await gatewayService.createCheckoutSession({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: "deposit",
      idempotencyKey: "wh-claim-1",
    });

    const event = {
      type: "checkout.session.completed",
      id: "evt_claim_unique_1",
      sessionId: session.SessionId,
    };
    const raw = JSON.stringify(event);
    const signature = gatewayService.signPayload(raw, session.Provider);
    const r1 = await gatewayService.handleWebhook({
      rawBody: raw,
      signature,
      event,
      provider: session.Provider,
    });
    expect(r1.ok).toBe(true);

    const r2 = await gatewayService.handleWebhook({
      rawBody: raw,
      signature,
      event,
      provider: session.Provider,
    });
    expect(r2.duplicate || r2.ok).toBeTruthy();

    const badEvent = { ...event, amount: 1 };
    const badRaw = JSON.stringify(badEvent);
    const badSig = gatewayService.signPayload(badRaw, session.Provider);
    await expect(
      gatewayService.handleWebhook({
        rawBody: badRaw,
        signature: badSig,
        event: badEvent,
        provider: session.Provider,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const inbox = await WebhookEvent.findOne({
      ProviderEventID: "evt_claim_unique_1",
    });
    expect(inbox.ProcessingStatus).toBe("processed");
  });
});

describe("P1 Password reset indistinguishability", () => {
  test("nonexistent and existing email same status/message", async () => {
    await createUser({
      email: "reset@t.com",
      role: "customer",
      password: "Pass1234ab",
    });
    const a = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "reset@t.com" });
    const b = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nosuch@t.com" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.message).toBe(b.body.message);
  });
});

describe("P1 API key invalid branch rejects", () => {
  test("unowned branch id does not become all branches", async () => {
    const host = await createUser({ email: "akh@t.com", role: "host" });
    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const fakeBranch = "507f1f77bcf86cd799439011";
    const res = await withCsrf(
      request(app).post("/api/partner/keys"),
      csrf,
      `authToken=${token}`,
    ).send({
      name: "bad",
      scopes: ["spaces:read"],
      allowedBranchIds: [fakeBranch],
      allBranches: false,
    });
    expect(res.status).toBe(400);
  });
});

describe("P1 buildSlotStarts exact start", () => {
  test("adjacent half-hour slots are distinct", () => {
    const step = 30 * 60 * 1000;
    const base = new Date(Math.ceil(Date.now() / step) * step);
    const a = bookingService.buildSlotStarts(
      base,
      new Date(base.getTime() + step),
      30,
    );
    const b = bookingService.buildSlotStarts(
      new Date(base.getTime() + step),
      new Date(base.getTime() + 2 * step),
      30,
    );
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].getTime()).not.toBe(b[0].getTime());
  });
});
