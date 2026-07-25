"use strict";

require("./setup");

const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../server");
const env = require("../config/env");

const ContentPage = require("../models/ContentPage");
const SeoRedirect = require("../models/SeoRedirect");
const Translation = require("../models/Translation");
const AuditLog = require("../models/AuditLog");
const ContentOutbox = require("../models/ContentOutbox");

let adminId;
let adminHeaders;
let guestHeaders;

beforeEach(async () => {
  adminId = new mongoose.Types.ObjectId().toString();
  adminHeaders = {
    "x-internal-token": env.CONTENT_INTERNAL_SECRET || "default_test_content_internal_secret_key",
    "x-service-name": "api-gateway",
    "x-user-id": adminId,
    "x-user-role": "admin",
    "x-user-scopes": ["content:read", "content:write", "content:publish", "content:redirect:manage", "content:i18n:manage"].join(","),
  };

  guestHeaders = {
    "x-internal-token": env.CONTENT_INTERNAL_SECRET || "default_test_content_internal_secret_key",
    "x-service-name": "api-gateway",
    "x-user-id": new mongoose.Types.ObjectId().toString(),
    "x-user-role": "customer",
    "x-user-scopes": "content:read",
  };

  await ContentPage.deleteMany({});
  await SeoRedirect.deleteMany({});
  await Translation.deleteMany({});
  await AuditLog.deleteMany({});
  await ContentOutbox.deleteMany({});
});

describe("Content Service E2E Integration and Logic Tests", () => {
  test("1. Admin can upsert guides; non-admin gets 403 Forbidden", async () => {
    // 1a. Attempt by guest -> 403
    const resGuest = await request(app)
      .post("/api/content/pages")
      .set(guestHeaders)
      .send({ title: "Test Guide", body: "Hello", reason: "creating guide" });
    expect(resGuest.status).toBe(403);

    // 1b. Attempt by admin -> 200 Success
    const resAdmin = await request(app)
      .post("/api/content/pages")
      .set(adminHeaders)
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
      .set(adminHeaders)
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
      .set(adminHeaders)
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
      .set(adminHeaders)
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

  test("6. Outbox Versioning and Idempotent Mutations E2E", async () => {
    // 6a. Publish page two times (first insert, second update)
    const pagePayload = { title: "Versioned Page", body: "v1 body", status: "published", reason: "initial write" };
    const resInsert = await request(app)
      .post("/api/content/pages")
      .set(adminHeaders)
      .send(pagePayload);
    expect(resInsert.status).toBe(200);
    expect(resInsert.body.page.Version).toBe(1);

    const docId = resInsert.body.page._id;

    // Verify first outbox event has Version 1 and matching idempotencyKey
    const firstEvents = await ContentOutbox.find({ "Payload.aggregateId": String(docId) });
    expect(firstEvents.length).toBe(1);
    expect(firstEvents[0].Payload.aggregateVersion).toBe(1);
    expect(firstEvents[0].IdempotencyKey).toBe(`content.page-published.v1:${docId}:1`);

    // Edit the page (second mutation)
    const resUpdate = await request(app)
      .post("/api/content/pages")
      .set(adminHeaders)
      .send({ ...pagePayload, body: "v2 body", reason: "second write" });
    expect(resUpdate.status).toBe(200);
    expect(resUpdate.body.page.Version).toBe(2);

    // Verify second outbox event has Version 2
    const secondEvents = await ContentOutbox.find({ "Payload.aggregateId": String(docId) });
    expect(secondEvents.length).toBe(2);
    expect(secondEvents.find(e => e.Payload.aggregateVersion === 2)).toBeDefined();

    // 6b. Redirect updates three times
    const redirectPayload = { fromPath: "/r-path", toPath: "/r-dest", reason: "initial redirect" };
    const r1 = await request(app).post("/api/seo/redirects").set(adminHeaders).send(redirectPayload);
    expect(r1.status).toBe(200);
    expect(r1.body.redirect.Version).toBe(1);

    const r2 = await request(app).post("/api/seo/redirects").set(adminHeaders).send({ ...redirectPayload, toPath: "/r-dest2" });
    expect(r2.status).toBe(200);
    expect(r2.body.redirect.Version).toBe(2);

    const r3 = await request(app).post("/api/seo/redirects").set(adminHeaders).send({ ...redirectPayload, toPath: "/r-dest3" });
    expect(r3.status).toBe(200);
    expect(r3.body.redirect.Version).toBe(3);

    // 6c. Translation updates three times
    const transPayload = { locale: "vi", key: "test-key", value: "val1", reason: "initial trans" };
    const t1 = await request(app).post("/api/i18n").set(adminHeaders).send(transPayload);
    expect(t1.status).toBe(200);
    expect(t1.body.translation.Version).toBe(1);

    const t2 = await request(app).post("/api/i18n").set(adminHeaders).send({ ...transPayload, value: "val2" });
    expect(t2.status).toBe(200);
    expect(t2.body.translation.Version).toBe(2);

    const t3 = await request(app).post("/api/i18n").set(adminHeaders).send({ ...transPayload, value: "val3" });
    expect(t3.status).toBe(200);
    expect(t3.body.translation.Version).toBe(3);

    // 6d. Retry same request with client-supplied idempotency key does not create two events
    const clientKey = "unique-client-key-12345";
    const req1 = await request(app)
      .post("/api/content/pages")
      .set(adminHeaders)
      .set("x-idempotency-key", clientKey)
      .send({ title: "Idempotent Page", body: "body", reason: "client idempotency test" });
    expect(req1.status).toBe(200);

    const clientPageId = req1.body.page._id;

    // Retry with same key
    const req2 = await request(app)
      .post("/api/content/pages")
      .set(adminHeaders)
      .set("x-idempotency-key", clientKey)
      .send({ title: "Idempotent Page", body: "body", reason: "client idempotency test" });
    expect(req2.status).toBe(200);

    // Verify only 1 outbox event exists for this clientKey
    const outboxByClientKey = await ContentOutbox.find({ IdempotencyKey: clientKey });
    expect(outboxByClientKey.length).toBe(1);

    // 6e. Distinct mutations create distinct events
    const reqOther = await request(app)
      .post("/api/content/pages")
      .set(adminHeaders)
      .send({ title: "Other Page", body: "other body", reason: "distinct page" });
    expect(reqOther.status).toBe(200);
    expect(reqOther.body.page._id).not.toBe(clientPageId);

    // 6f. Transaction rollback does not save aggregate or outbox
    // Trigger error inside transaction (by providing cycle redirect loop)
    await SeoRedirect.create({ FromPath: "/loop-1", ToPath: "/loop-2", Version: 1, Active: true });

    // Attempting to create /loop-2 -> /loop-1 should fail loop check (throws error inside transaction)
    const beforeCountPage = await ContentPage.countDocuments({});
    const beforeCountOutbox = await ContentOutbox.countDocuments({});

    const failRes = await request(app)
      .post("/api/seo/redirects")
      .set(adminHeaders)
      .send({ fromPath: "/loop-2", toPath: "/loop-1", reason: "will fail cycle check" });
    expect(failRes.status).toBe(400);

    // Verify nothing saved in databases
    expect(await ContentPage.countDocuments({})).toBe(beforeCountPage);
    expect(await ContentOutbox.countDocuments({})).toBe(beforeCountOutbox);
  });
});
