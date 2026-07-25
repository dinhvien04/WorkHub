"use strict";

require("./setup");

const pushService = require("../services/pushService");
const PushSubscription = require("../models/PushSubscription");
const PushDelivery = require("../models/PushDelivery");
const mongoose = require("mongoose");
const webpush = require("web-push");

jest.mock("web-push");

describe("PushService SSRF Protection and Dispatch Tests", () => {
  beforeEach(async () => {
    await PushSubscription.deleteMany({});
    jest.clearAllMocks();
  });

  test("validateEndpoint throws ValidationError for non-https protocol", async () => {
    await expect(
      pushService.saveSubscription({
        userId: new mongoose.Types.ObjectId(),
        endpoint: "http://fcm.googleapis.com/send",
        keys: { p256dh: "key_dh", auth: "auth_key" },
      })
    ).rejects.toThrow("giao thức https");
  });

  test("validateEndpoint throws ValidationError for private IP endpoints (SSRF)", async () => {
    // 127.0.0.1 resolving host (safe.com is permitted suffix in test, let's test localhost IP)
    await expect(
      pushService.saveSubscription({
        userId: new mongoose.Types.ObjectId(),
        endpoint: "https://127.0.0.1/send",
        keys: { p256dh: "key_dh", auth: "auth_key" },
      })
    ).rejects.toThrow("Endpoint không được phép");
  });

  test("saveSubscription successfully saves active subscription for trusted host", async () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = await pushService.saveSubscription({
      userId,
      endpoint: "https://fcm.googleapis.com/send/token123",
      keys: { p256dh: "key_dh_p256dh_length_ok", auth: "auth_key_ok" },
      userAgent: "Mozilla/5.0",
    });

    expect(doc).toBeTruthy();
    expect(doc.Status).toBe("active");

    const saved = await PushSubscription.findOne({ UserID: userId });
    expect(saved.Endpoint).toBe("https://fcm.googleapis.com/send/token123");
  });

  test("notifyPush revokes subscription on 404/410 push errors", async () => {
    const userId = new mongoose.Types.ObjectId();
    const sub = await PushSubscription.create({
      UserID: userId,
      Endpoint: "https://fcm.googleapis.com/send/token404",
      Keys: { p256dh: "key_dh_p256dh_length_ok", auth: "auth_key_ok" },
      Status: "active",
    });

    // Mock webpush.sendNotification to reject with 410 Gone
    const err = new Error("Subscription expired");
    err.statusCode = 410;
    webpush.sendNotification.mockRejectedValue(err);

    // VAPID details initialized logic stubbed in test via global override mock
    process.env.VAPID_PUBLIC_KEY = "testkey";
    process.env.VAPID_PRIVATE_KEY = "testprivate";

    const result = await pushService.notifyPush(userId, { title: "Title", body: "Body" });

    // Assert it attempted but completed with 0 success and revoked sub
    expect(result.sent).toBe(0);
    const updated = await PushSubscription.findById(sub._id);
    expect(updated.Status).toBe("revoked");
  });

  test("notifyPush throws retryable error on 429 rate limit", async () => {
    const userId = new mongoose.Types.ObjectId();
    await PushSubscription.create({
      UserID: userId,
      Endpoint: "https://fcm.googleapis.com/send/token429",
      Keys: { p256dh: "key_dh_p256dh_length_ok", auth: "auth_key_ok" },
      Status: "active",
    });

    const err = new Error("Too many requests");
    err.statusCode = 429;
    webpush.sendNotification.mockRejectedValue(err);

    process.env.VAPID_PUBLIC_KEY = "testkey";
    process.env.VAPID_PRIVATE_KEY = "testprivate";

    await expect(
      pushService.notifyPush(userId, { title: "Title", body: "Body" })
    ).rejects.toThrow("Too many requests");
  });

  test("notifyPush is idempotent: skips sending to subscription if successful PushDelivery already exists for outboxItemId", async () => {
    const userId = new mongoose.Types.ObjectId();
    const sub = await PushSubscription.create({
      UserID: userId,
      Endpoint: "https://fcm.googleapis.com/send/tokenIdemp",
      Keys: { p256dh: "key_dh_p256dh_length_ok", auth: "auth_key_ok" },
      Status: "active",
    });

    const outboxItemId = new mongoose.Types.ObjectId();

    // Pre-seed successful PushDelivery for this subscription + outboxItem (simulating crash recovery)
    await PushDelivery.create({
      UserID: userId,
      SubscriptionID: sub._id,
      OutboxItemID: outboxItemId,
      Payload: { title: "Title", body: "Body" },
      Status: "success",
      StatusCode: 201,
    });

    process.env.VAPID_PUBLIC_KEY = "testkey";
    process.env.VAPID_PRIVATE_KEY = "testprivate";

    // Call notifyPush with outboxItemId
    const result = await pushService.notifyPush(userId, { title: "Title", body: "Body" }, outboxItemId);

    // Verify it reports success
    expect(result.sent).toBe(1);

    // Assert that webpush.sendNotification was NOT called since it was skipped idempotently!
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
