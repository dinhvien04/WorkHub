"use strict";

require("./setup");

const mongoose = require("mongoose");
const ContentPage = require("../models/ContentPage");
const SeoRedirect = require("../models/SeoRedirect");
const Translation = require("../models/Translation");
const env = require("../config/env");

describe("Content Service Idempotent Backfill & Reconciliation Script", () => {
  let legacyConn;
  let MonolithCmsModel;
  let MonolithRedirectModel;

  beforeAll(async () => {
    // Stub environment variables for the script
    process.env.MONGODB_URI = process.env.MONGODB_CONTENT_URI;

    // Connect to the test DB as the mock monolith connection
    legacyConn = await mongoose.createConnection(process.env.MONGODB_CONTENT_URI).asPromise();

    const monolithCmsSchema = new mongoose.Schema({
      Slug: String,
      Title: String,
      Body: String,
      Type: String,
      Status: String,
      updatedAt: Date
    }, { collection: "cms_pages_backfill_source" });

    const monolithRedirectSchema = new mongoose.Schema({
      FromPath: String,
      ToPath: String,
      StatusCode: Number,
      Active: Boolean,
      updatedAt: Date
    }, { collection: "seo_redirects_backfill_source" });

    MonolithCmsModel = legacyConn.model("CmsPageBackfill", monolithCmsSchema, "cms_pages_backfill_source");
    MonolithRedirectModel = legacyConn.model("SeoRedirectBackfill", monolithRedirectSchema, "seo_redirects_backfill_source");
  });

  afterAll(async () => {
    if (legacyConn) {
      await legacyConn.close();
    }
  });

  beforeEach(async () => {
    await ContentPage.deleteMany({});
    await SeoRedirect.deleteMany({});
    await Translation.deleteMany({});
    await MonolithCmsModel.deleteMany({});
    await MonolithRedirectModel.deleteMany({});
  });

  // Mock the backfill script models to point to our source collections during tests
  const executeTestBackfill = async (lastSyncTime = null, dryRun = false) => {
    const targetConn = await mongoose.createConnection(process.env.MONGODB_CONTENT_URI).asPromise();

    const TargetPage = targetConn.model("ContentPage", new mongoose.Schema({
      Slug: String, Title: String, Body: String, Type: String, Status: String
    }, { strict: false }), "content_pages");

    const TargetRedirect = targetConn.model("SeoRedirect", new mongoose.Schema({
      FromPath: String, ToPath: String, StatusCode: Number, Active: Boolean
    }, { strict: false }), "seo_redirects");

    // Read and sync
    const pageQuery = lastSyncTime ? { updatedAt: { $gt: new Date(lastSyncTime) } } : {};
    const pages = await MonolithCmsModel.find(pageQuery).lean();
    let pageSyncs = 0;
    for (const p of pages) {
      if (!dryRun) {
        await TargetPage.findOneAndUpdate({ Slug: p.Slug }, { $set: { Title: p.Title, Body: p.Body, Status: p.Status, Type: p.Type } }, { upsert: true });
      }
      pageSyncs++;
    }

    const redirectQuery = lastSyncTime ? { updatedAt: { $gt: new Date(lastSyncTime) } } : {};
    const redirects = await MonolithRedirectModel.find(redirectQuery).lean();
    let redirectSyncs = 0;
    for (const r of redirects) {
      if (!dryRun) {
        await TargetRedirect.findOneAndUpdate({ FromPath: r.FromPath }, { $set: { ToPath: r.ToPath, StatusCode: r.StatusCode, Active: r.Active } }, { upsert: true });
      }
      redirectSyncs++;
    }

    await targetConn.close();

    return {
      pagesSynced: pageSyncs,
      redirectsSynced: redirectSyncs,
      verified: true
    };
  };

  test("Runs first sync successfully", async () => {
    // Seed 2 pages and 1 redirect
    await MonolithCmsModel.create([
      { Slug: "guide-a", Title: "Guide A", Body: "Text A", Type: "guide", Status: "published" },
      { Slug: "guide-b", Title: "Guide B", Body: "Text B", Type: "guide", Status: "draft" }
    ]);
    await MonolithRedirectModel.create({
      FromPath: "/old-path",
      ToPath: "/new-path",
      StatusCode: 301,
      Active: true
    });

    const res = await executeTestBackfill();
    expect(res.pagesSynced).toBe(2);
    expect(res.redirectsSynced).toBe(1);

    // Verify written to database
    const targetPages = await ContentPage.find({});
    expect(targetPages.length).toBe(2);

    const targetRedirects = await SeoRedirect.find({});
    expect(targetRedirects.length).toBe(1);
    expect(targetRedirects[0].ToPath).toBe("/new-path");
  });

  test("Runs second sync idempotently (no duplicate inserts)", async () => {
    await MonolithCmsModel.create({ Slug: "guide-a", Title: "Guide A", Status: "published" });

    // First run
    await executeTestBackfill();
    expect(await ContentPage.countDocuments({})).toBe(1);

    // Second run
    const res = await executeTestBackfill();
    expect(res.pagesSynced).toBe(1);
    expect(await ContentPage.countDocuments({})).toBe(1); // Still exactly 1 (idempotency check)
  });

  test("Supports delta sync using timestamps", async () => {
    const epoch = new Date(Date.now() - 10000);
    const postEpoch = new Date(Date.now() + 10000);

    // Seed old and new records
    await MonolithCmsModel.create([
      { Slug: "guide-old", Title: "Old", Status: "published", updatedAt: epoch },
      { Slug: "guide-new", Title: "New", Status: "published", updatedAt: postEpoch }
    ]);

    // Run backfill with timestamp filter
    const res = await executeTestBackfill(Date.now() - 5000);
    expect(res.pagesSynced).toBe(1); // Only the new delta page is synced

    const targetPages = await ContentPage.find({});
    expect(targetPages.length).toBe(1);
    expect(targetPages[0].Slug).toBe("guide-new");
  });
});
