"use strict";

require("./setup");

const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../server");
const env = require("../config/env");

const Notification = require("../models/Notification");
const NotificationPreference = require("../models/NotificationPreference");

describe("Notifications & Preferences API Routes Integration", () => {
  let userId;
  let internalHeaders;

  beforeEach(async () => {
    userId = new mongoose.Types.ObjectId().toString();
    internalHeaders = {
      "x-internal-token": env.COMMUNICATION_INTERNAL_SECRET || "default_test_communication_internal_secret_key",
      "x-user-id": userId,
      "x-user-role": "customer",
    };

    await Notification.deleteMany({});
    await NotificationPreference.deleteMany({});
  });

  test("GET /api/notifications requires auth token", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  test("GET /api/notifications returns user feed", async () => {
    // Seed 2 notifications
    await Notification.create([
      { UserID: userId, Title: "Alert 1", Body: "Text 1", Type: "system" },
      { UserID: userId, Title: "Alert 2", Body: "Text 2", Type: "booking", IsRead: true },
    ]);

    const res = await request(app)
      .get("/api/notifications")
      .set(internalHeaders);

    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBe(2);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.pagination.total).toBe(2);
  });

  test("PATCH /api/notifications/:id/read updates status", async () => {
    const notif = await Notification.create({
      UserID: userId,
      Title: "Alert",
      Body: "Text",
      IsRead: false,
    });

    const res = await request(app)
      .patch(`/api/notifications/${notif._id}/read`)
      .set(internalHeaders);

    expect(res.status).toBe(200);
    expect(res.body.notification.IsRead).toBe(true);

    const saved = await Notification.findById(notif._id);
    expect(saved.IsRead).toBe(true);
  });

  test("POST /api/notifications/read-all marks everything read", async () => {
    await Notification.create([
      { UserID: userId, Title: "Alert 1", IsRead: false },
      { UserID: userId, Title: "Alert 2", IsRead: false },
    ]);

    const res = await request(app)
      .post("/api/notifications/read-all")
      .set(internalHeaders);

    expect(res.status).toBe(200);

    const unread = await Notification.countDocuments({ UserID: userId, IsRead: false });
    expect(unread).toBe(0);
  });

  test("DELETE /api/notifications/:id deletes notification", async () => {
    const notif = await Notification.create({
      UserID: userId,
      Title: "Alert",
    });

    const res = await request(app)
      .delete(`/api/notifications/${notif._id}`)
      .set(internalHeaders);

    expect(res.status).toBe(200);

    const exists = await Notification.findById(notif._id);
    expect(exists).toBeNull();
  });

  test("GET & PUT /api/notifications/preferences works cleanly", async () => {
    // 1. GET default preferences
    const resGet = await request(app)
      .get("/api/notifications/preferences")
      .set(internalHeaders);

    expect(resGet.status).toBe(200);
    expect(resGet.body.preferences.NotifyEmail).toBe(true);

    // 2. PUT updates preferences
    const resPut = await request(app)
      .put("/api/notifications/preferences")
      .set(internalHeaders)
      .send({ notifyEmail: false, timezone: "Asia/Ho_Chi_Minh" });

    expect(resPut.status).toBe(200);
    expect(resPut.body.preferences.NotifyEmail).toBe(false);

    const saved = await NotificationPreference.findOne({ UserID: userId });
    expect(saved.NotifyEmail).toBe(false);
    expect(saved.Timezone).toBe("Asia/Ho_Chi_Minh");
  });
});
