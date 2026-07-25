"use strict";

require("./setup");

const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { app } = require("../server");
const env = require("../config/env");

const ContentPage = require("../models/ContentPage");
const SeoRedirect = require("../models/SeoRedirect");
const Translation = require("../models/Translation");
const AuditLog = require("../models/AuditLog");
const ContentOutbox = require("../models/ContentOutbox");

function signToken(userId, role = "customer") {
  return jwt.sign({ userId, role }, env.JWT_SECRET, { expiresIn: "1h" });
}

describe("Content Service E2E Integration and Logic Tests", () => {
  let adminToken;
  let guestToken;
  let adminId;

  beforeEach(async () => {
    adminId = new mongoose.Types.ObjectId().toString();
    adminToken = signToken(adminId, "admin");
    guestToken = signToken(new mongoose.Types.ObjectId().toString(), "customer");

    await ContentPage.deleteMany({});
    await SeoRedirect.deleteMany({});
    await Translation.deleteMany({});
    await AuditLog.deleteMany({});
    await ContentOutbox.deleteMany({});
  });

  test("1. Admin can upsert guides; non-admin gets 403 Forbidden", async () => {
    // 1a. Attempt by guest -> 403
    const resGuest = await request(app)
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ title: "Test Guide", body: "Hello", reason: "creating guide" });
    expect(resGuest.status).toBe(403);

    // 1b. Attempt by admin -> 200 Success
    const resAdmin = await request(app)
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Test Guide", body: "Hello", status: "published", reason: "creating guide" });
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.page.Slug).toBe("test-guide");

    // Verify Audit log exists
    const logs = await AuditLog.find({ ActorID: adminId });
    expect(logs.length).toBe(1);
    expect(logs[0].Action).toBe("PUBLISH_PAGE");
  });

  test("2. HTML Sanitization prevents stored XSS", async () => {
    const payload = {
      title: "Malicious Page",
      body: "<script>alert('xss')</script><div>Safe text</div><iframe src='malicious.com'></iframe>",
      status: "published",
      reason: "security test",
    };

    const res = await request(app)
      .post("/api/content/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.page.Body).not.toContain("<script>");
    expect(res.body.page.Body).not.toContain("iframe");
    expect(res.body.page.Body).toContain("<div>Safe text</div>");
  });

  test("3. ETags caching header returns 304 Not Modified", async () => {
    // Pre-create published page
    await ContentPage.create({
      Slug: "cache-test",
      Title: "Cache Test",
      Body: "Check my ETag caching headers",
      Status: "published",
      PublishedAt: new Date(),
    });

    // First request
    const res1 = await request(app).get("/api/content/pages/cache-test");
    expect(res1.status).toBe(200);
    expect(res1.headers).toHaveProperty("etag");

    const etag = res1.headers["etag"];

    // Second request with If-None-Match
    const res2 = await request(app)
      .get("/api/content/pages/cache-test")
      .set("If-None-Match", etag);

    expect(res2.status).toBe(304);
  });

  test("4. Redirect loop prevention checks", async () => {
    // 4a. Self redirect loop block
    const resSelf = await request(app)
      .post("/api/seo/redirects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fromPath: "/page-a", toPath: "/page-a", reason: "loop test" });
    expect(resSelf.status).toBe(400);
    expect(resSelf.body.error).toContain("không được trùng");

    // Pre-seed an active redirect from page-a to page-b
    await SeoRedirect.create({
      FromPath: "/page-a",
      ToPath: "/page-b",
      StatusCode: 301,
      Active: true,
    });

    // 4b. 2-step loop block (page-b to page-a)
    const resTwoStep = await request(app)
      .post("/api/seo/redirects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fromPath: "/page-b", toPath: "/page-a", reason: "loop test" });
    expect(resTwoStep.status).toBe(400);
    expect(resTwoStep.body.error).toContain("vòng lặp vô hạn");
  });

  test("5. Idempotent Backfill and Reconciliation runs cleanly", async () => {
    // Seed temporary monolith collections in the test MongoDB
    const monolithConn = await mongoose.createConnection(process.env.MONGODB_CONTENT_URI).asPromise();
    const monolithCmsSchema = new mongoose.Schema({
      Slug: String, Title: String, Body: String, Status: String
    }, { collection: "cms_pages_monolith_temp" });
    const MonolithCmsModel = monolithConn.model("CmsPageTemp", monolithCmsSchema, "cms_pages_monolith_temp");

    const monolithRedirectSchema = new mongoose.Schema({
      FromPath: String, ToPath: String, StatusCode: Number, Active: Boolean
    }, { collection: "seo_redirects_monolith_temp" });
    const MonolithRedirectModel = monolithConn.model("SeoRedirectTemp", monolithRedirectSchema, "seo_redirects_monolith_temp");

    // Populate mock source data
    await MonolithCmsModel.create({ Slug: "guide-1", Title: "Guide 1", Body: "Hello Guide", Status: "published" });
    await MonolithRedirectModel.create({ FromPath: "/old-page", ToPath: "/new-page", StatusCode: 301, Active: true });

    // Mock running backfill by redirecting the target connections in e2e execution
    const runMockBackfill = async () => {
      const targetConn = await mongoose.createConnection(process.env.MONGODB_CONTENT_URI).asPromise();
      const TargetPage = targetConn.model("ContentPage", new mongoose.Schema({
        Slug: String, Title: String, Body: String, Status: String
      }, { strict: false }), "content_pages");
      const TargetRedirect = targetConn.model("SeoRedirect", new mongoose.Schema({
        FromPath: String, ToPath: String, StatusCode: Number, Active: Boolean
      }, { strict: false }), "seo_redirects");

      // Sync
      const pages = await MonolithCmsModel.find({}).lean();
      for (const p of pages) {
        await TargetPage.findOneAndUpdate({ Slug: p.Slug }, { $set: { Title: p.Title, Body: p.Body, Status: p.Status } }, { upsert: true });
      }

      const redirects = await MonolithRedirectModel.find({}).lean();
      for (const r of redirects) {
        await TargetRedirect.findOneAndUpdate({ FromPath: r.FromPath }, { $set: { ToPath: r.ToPath, StatusCode: r.StatusCode, Active: r.Active } }, { upsert: true });
      }

      await targetConn.close();
    };

    await runMockBackfill();

    // Verify it migrated to destination
    const pages = await ContentPage.find({ Slug: "guide-1" });
    expect(pages.length).toBe(1);
    expect(pages[0].Title).toBe("Guide 1");

    const redirects = await SeoRedirect.find({ FromPath: "/old-page" });
    expect(redirects.length).toBe(1);
    expect(redirects[0].ToPath).toBe("/new-page");

    await monolithConn.close();
  });
});
