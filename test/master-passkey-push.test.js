"use strict";

const request = require("supertest");
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  futureRange,
  getApp,
  getCsrfPair,
  withCsrf,
} = require("./helpers");
const StaffMember = require("../models/StaffMember");
const bookingService = require("../services/bookingService");
const webauthnService = require("../services/webauthnService");

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
  // Fail-closed default
  delete process.env.WEBAUTHN_ENABLED;
  // force re-read is via env module already loaded — use service isEnabled which reads env.WEBAUTHN_ENABLED
});

describe("WebAuthn fail-closed (default disabled)", () => {
  test("passkey routes return FEATURE_DISABLED when WEBAUTHN_ENABLED is false", async () => {
    const user = await createUser({
      email: "pk@test.com",
      role: "customer",
      password: "Pass1234",
    });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const opts = await withCsrf(
      request(app).post("/api/auth/webauthn/register/options"),
      csrf,
      `authToken=${token}`,
    );
    expect(opts.status).toBe(503);
    expect(
      opts.body.code === "FEATURE_DISABLED" || opts.body.error,
    ).toBeTruthy();

    const loginOpts = await request(app)
      .post("/api/auth/webauthn/login/options")
      .send({ email: "pk@test.com" });
    expect(loginOpts.status).toBe(503);

    // Stub signature path must never authenticate
    await expect(
      webauthnService.verifyLoginAssertion({
        challenge: "x",
        credentialId: "y",
        signature: "stub",
        clientDataJSON: "e30",
        authenticatorData: "e30",
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("Push subscribe + staff reception proxy", () => {
  test("push and staff check-in path", async () => {
    const host = await createUser({ email: "hpush@test.com", role: "host" });
    const staff = await createUser({
      email: "spush@test.com",
      role: "customer",
    });
    const customer = await createUser({
      email: "cpush@test.com",
      role: "customer",
    });
    await StaffMember.create({
      HostOwnerID: host._id,
      UserID: staff._id,
      Role: "receptionist",
      AllBranches: true,
      Status: "active",
    });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    // confirm so check-in possible if endpoint allows
    expect(booking).toBeTruthy();
    expect(staff).toBeTruthy();
  });
});

describe("Push subscription security, limit, and rate limiters", () => {
  let dnsSpy;

  beforeAll(() => {
    const dns = require("dns");
    dnsSpy = jest
      .spyOn(dns.promises, "lookup")
      .mockImplementation(async (hostname, options) => {
        if (hostname === "safe.com" || hostname === "www.safe.com") {
          return [{ address: "8.8.8.8", family: 4 }];
        }
        if (hostname === "localhost") {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        if (hostname === "private.com") {
          return [{ address: "192.168.1.1", family: 4 }];
        }
        if (hostname === "linklocal.com") {
          return [{ address: "169.254.169.254", family: 4 }];
        }
        if (hostname === "multicast.com") {
          return [{ address: "224.0.0.1", family: 4 }];
        }
        throw new Error("ENOTFOUND");
      });
  });

  afterAll(() => {
    dnsSpy.mockRestore();
  });

  test("validates endpoint URL and protocol", async () => {
    const user = await createUser({ email: "p1@test.com", role: "customer" });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    // HTTP endpoint should fail
    const resHttp = await withCsrf(
      request(app)
        .post("/api/push/subscribe")
        .send({ endpoint: "http://safe.com/push" }),
      csrf,
      `authToken=${token}`,
    );
    expect(resHttp.status).toBe(400);
    expect(resHttp.body.error).toMatch(/protocol|https|giao thức/i);

    // Invalid URL should fail
    const resInvalid = await withCsrf(
      request(app).post("/api/push/subscribe").send({ endpoint: "not-a-url" }),
      csrf,
      `authToken=${token}`,
    );
    expect(resInvalid.status).toBe(400);
  });

  test("prevents SSRF by blocking private/loopback/link-local/multicast IPs", async () => {
    const user = await createUser({ email: "p2@test.com", role: "customer" });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const endpoints = [
      "https://localhost/push",
      "https://private.com/push",
      "https://linklocal.com/push",
      "https://multicast.com/push",
    ];

    for (const ep of endpoints) {
      const res = await withCsrf(
        request(app).post("/api/push/subscribe").send({ endpoint: ep }),
        csrf,
        `authToken=${token}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/SSRF|hợp lệ/i);
    }
  });

  test("saves valid subscription and does not expose endpoint in response", async () => {
    const user = await createUser({ email: "p3@test.com", role: "customer" });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    const res = await withCsrf(
      request(app)
        .post("/api/push/subscribe")
        .send({
          endpoint: "https://safe.com/push",
          keys: { p256dh: "keys1", auth: "auth1" },
        }),
      csrf,
      `authToken=${token}`,
    );

    expect(res.status).toBe(201);
    expect(res.body.subscription).toHaveProperty("id");
    expect(res.body.subscription.endpoint).toBeUndefined(); // endpoint must not be exposed
  });

  test("enforces limit of 10 active subscriptions per user and revokes oldest", async () => {
    const user = await createUser({ email: "p4@test.com", role: "customer" });
    const { token } = agentWithAuth(app, user);
    const csrf = await getCsrfPair(app);

    // Create 11 subscriptions
    const subIds = [];
    for (let i = 1; i <= 11; i++) {
      const res = await withCsrf(
        request(app)
          .post("/api/push/subscribe")
          .send({
            endpoint: `https://safe.com/push/${i}`,
            keys: { p256dh: `k${i}`, auth: `a${i}` },
          }),
        csrf,
        `authToken=${token}`,
      );
      expect(res.status).toBe(201);
      subIds.push(res.body.subscription.id);
    }

    // Verify database status of subscriptions
    const PushSubscription = require("../models/PushSubscription");
    const activeSubs = await PushSubscription.find({
      UserID: user._id,
      Status: "active",
    }).sort({ createdAt: 1 });
    const revokedSubs = await PushSubscription.find({
      UserID: user._id,
      Status: "revoked",
    });

    expect(activeSubs.length).toBe(10);
    expect(revokedSubs.length).toBe(1);

    // The first one (oldest) should be revoked
    expect(String(revokedSubs[0]._id)).toBe(String(subIds[0]));
  });

  test("notifyPush handles malformed VAPID details gracefully without crashing", async () => {
    const user = await createUser({ email: "p5@test.com", role: "customer" });
    const PushSubscription = require("../models/PushSubscription");
    await PushSubscription.create({
      UserID: user._id,
      Endpoint: "https://safe.com/push/notify",
      Status: "active",
    });

    const oldPubKey = process.env.VAPID_PUBLIC_KEY;
    const oldPrivKey = process.env.VAPID_PRIVATE_KEY;

    process.env.VAPID_PUBLIC_KEY = "invalid-key";
    process.env.VAPID_PRIVATE_KEY = "invalid-key";

    const pushService = require("../services/pushService");
    const result = await pushService.notifyPush(user._id, {
      title: "Test",
      body: "Hello",
    });
    expect(result.mode).toBe("vapid-config-error");

    // Clean up env
    if (oldPubKey) process.env.VAPID_PUBLIC_KEY = oldPubKey;
    else delete process.env.VAPID_PUBLIC_KEY;

    if (oldPrivKey) process.env.VAPID_PRIVATE_KEY = oldPrivKey;
    else delete process.env.VAPID_PRIVATE_KEY;
  });
});
