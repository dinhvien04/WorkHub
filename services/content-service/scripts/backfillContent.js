"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

async function runBackfill(lastSyncTime = null) {
  const legacyUri = process.env.MONGODB_URI;
  const targetUri = process.env.MONGODB_CONTENT_URI;

  if (!legacyUri || !targetUri) {
    console.error("Missing MONGODB_URI or MONGODB_CONTENT_URI environment variables.");
    process.exit(1);
  }

  const legacyConn = await mongoose.createConnection(legacyUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  // Monolith models/schemas
  const monolithCmsSchema = new mongoose.Schema({}, { strict: false });
  const MonolithCms = legacyConn.model("CmsPage", monolithCmsSchema, "cms_pages");

  const monolithRedirectSchema = new mongoose.Schema({}, { strict: false });
  const MonolithRedirect = legacyConn.model("SeoRedirect", monolithRedirectSchema, "seo_redirects");

  // Content Service target models/schemas
  const contentPageSchema = new mongoose.Schema({
    Slug: String,
    Title: String,
    Body: String,
    MetaTitle: String,
    MetaDescription: String,
    Type: String,
    Status: String,
    CitySlug: String,
    PublishedAt: Date,
    AuthorID: mongoose.Schema.Types.ObjectId,
  }, { strict: false });
  const TargetPage = targetConn.model("ContentPage", contentPageSchema, "content_pages");

  const seoRedirectSchema = new mongoose.Schema({
    FromPath: String,
    ToPath: String,
    StatusCode: Number,
    Active: Boolean,
    Note: String,
  }, { strict: false });
  const TargetRedirect = targetConn.model("SeoRedirect", seoRedirectSchema, "seo_redirects");

  const translationSchema = new mongoose.Schema({
    Locale: String,
    Key: String,
    Value: String,
  }, { strict: false });
  const TargetTranslation = targetConn.model("Translation", translationSchema, "translations");

  // 1. Reconciliation Phase: Count records before backfill
  const sourceCmsCount = await MonolithCms.countDocuments({});
  const sourceRedirectCount = await MonolithRedirect.countDocuments({});

  const targetCmsCountBefore = await TargetPage.countDocuments({});
  const targetRedirectCountBefore = await TargetRedirect.countDocuments({});

  console.log("[Reconciliation] Pre-migration Content Statistics:");
  console.log(`- Monolith CMS pages count: ${sourceCmsCount}`);
  console.log(`- Target ContentPage count: ${targetCmsCountBefore}`);
  console.log(`- Monolith SEO Redirects count: ${sourceRedirectCount}`);
  console.log(`- Target SEO Redirects count: ${targetRedirectCountBefore}`);

  // 2. Migration Phase: Sync CMS Pages (Deltas supported)
  const pageFilter = {};
  if (lastSyncTime) {
    pageFilter.updatedAt = { $gt: new Date(lastSyncTime) };
    console.log(`[Backfill] Processing CMS page deltas updated after: ${lastSyncTime}`);
  }

  const pages = await MonolithCms.find(pageFilter).lean();
  let pagesSyncCount = 0;

  for (const p of pages) {
    await TargetPage.findOneAndUpdate(
      { Slug: p.Slug },
      {
        $set: {
          Title: p.Title,
          Body: p.Body || "",
          MetaTitle: p.MetaTitle || "",
          MetaDescription: p.MetaDescription || "",
          Type: p.Type || "guide",
          Status: p.Status || "draft",
          CitySlug: p.CitySlug || "",
          PublishedAt: p.PublishedAt || null,
          AuthorID: p.AuthorID || null,
        },
      },
      { upsert: true }
    );
    pagesSyncCount++;
  }

  // 3. Migration Phase: Sync SEO Redirects (Deltas supported)
  const redirectFilter = {};
  if (lastSyncTime) {
    redirectFilter.updatedAt = { $gt: new Date(lastSyncTime) };
    console.log(`[Backfill] Processing SEO redirects deltas updated after: ${lastSyncTime}`);
  }

  const redirects = await MonolithRedirect.find(redirectFilter).lean();
  let redirectsSyncCount = 0;

  for (const r of redirects) {
    await TargetRedirect.findOneAndUpdate(
      { FromPath: r.FromPath },
      {
        $set: {
          ToPath: r.ToPath,
          StatusCode: r.StatusCode || 301,
          Active: r.Active !== false,
          Note: r.Note || "",
        },
      },
      { upsert: true }
    );
    redirectsSyncCount++;
  }

  // 4. Migration Phase: Seed default translations from backend service file
  // (We load the dictionaries from the monolith service i18n dictionary file)
  let translationsSyncCount = 0;
  try {
    const monolithI18n = require("../../../apps/legacy-monolith/services/i18n");
    const dictionaries = monolithI18n.dictionaries || {};

    for (const [locale, keys] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(keys)) {
        await TargetTranslation.findOneAndUpdate(
          { Locale: locale, Key: key },
          { $set: { Value: String(value) } },
          { upsert: true }
        );
        translationsSyncCount++;
      }
    }
    console.log(`[Backfill] Seeded/synchronized ${translationsSyncCount} translation keys across locales.`);
  } catch (err) {
    console.error("[Backfill] Skipping translation seed due to import error:", err.message);
  }

  // 5. Reconciliation Phase: Count records after backfill and compare
  const targetCmsCountAfter = await TargetPage.countDocuments({});
  const targetRedirectCountAfter = await TargetRedirect.countDocuments({});

  console.log("[Reconciliation] Post-migration Content Statistics:");
  console.log(`- Target ContentPage count after: ${targetCmsCountAfter} (Synced in this run: ${pagesSyncCount})`);
  console.log(`- Target SEO Redirects count after: ${targetRedirectCountAfter} (Synced in this run: ${redirectsSyncCount})`);

  // Verify counts match source of truth
  const isCmsMatch = targetCmsCountAfter === sourceCmsCount;
  const isRedirectMatch = targetRedirectCountAfter === sourceRedirectCount;

  console.log("[Reconciliation] Verification Summary:");
  console.log(`- CMS Pages Sync match: ${isCmsMatch ? "SUCCESS (Counts match)" : "MISMATCH"}`);
  console.log(`- SEO Redirects Sync match: ${isRedirectMatch ? "SUCCESS (Counts match)" : "MISMATCH"}`);

  await legacyConn.close();
  await targetConn.close();
  console.log("[Backfill] Content data reconciliation complete.");

  return {
    pagesSynced: pagesSyncCount,
    redirectsSynced: redirectsSyncCount,
    verified: isCmsMatch && isRedirectMatch,
  };
}

if (require.main === module) {
  const syncTime = process.env.LAST_SYNC_TIME || null;
  runBackfill(syncTime).catch(console.error);
}

module.exports = { runBackfill };
