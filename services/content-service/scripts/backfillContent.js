"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

/**
 * Computes a SHA-256 fingerprint checksum of a page document's essential business keys.
 */
function computeChecksum(doc) {
  const data = JSON.stringify({
    Slug: doc.Slug,
    Title: doc.Title,
    Body: doc.Body || "",
    Type: doc.Type || "guide",
    Status: doc.Status || "draft"
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function runBackfill(lastSyncTime = null, dryRun = false) {
  const legacyUri = process.env.MONGODB_URI;
  const targetUri = process.env.MONGODB_CONTENT_URI;

  if (!legacyUri || !targetUri) {
    console.error("Missing MONGODB_URI or MONGODB_COMMUNICATION_URI environment variables.");
    process.exit(1);
  }

  const legacyConn = await mongoose.createConnection(legacyUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  // Monolith models/schemas (Strictly Content-related ONLY, no Push subscriptions references)
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
  console.log(`- Monolith CMS source pages count: ${sourceCmsCount}`);
  console.log(`- Target ContentPage count: ${targetCmsCountBefore}`);
  console.log(`- Monolith SEO Redirects count: ${sourceRedirectCount}`);
  console.log(`- Target SEO Redirects count: ${targetRedirectCountBefore}`);

  if (dryRun) {
    console.log("[Backfill] Dry run mode enabled. Bypassing database writes.");
  }

  // 2. Migration Phase: Sync CMS Pages (Cursor-based pagination using _id for stable resume)
  let lastId = null;
  const limit = 100;
  let pagesSyncCount = 0;
  let pagesConflictCount = 0;

  while (true) {
    const query = lastSyncTime ? { updatedAt: { $gt: new Date(lastSyncTime) } } : {};
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await MonolithCms.find(query).sort({ _id: 1 }).limit(limit).lean();
    if (batch.length === 0) break;

    for (const p of batch) {
      lastId = p._id;

      // Check for conflicts
      const existing = await TargetPage.findOne({ Slug: p.Slug }).lean();
      if (existing) {
        const sourceHash = computeChecksum(p);
        const targetHash = computeChecksum(existing);
        if (sourceHash !== targetHash) {
          pagesConflictCount++;
          console.warn(`[Reconciliation Warning] Content conflict detected for Slug: ${p.Slug} (Checksums differ)`);
        }
      }

      if (!dryRun) {
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
      }
      pagesSyncCount++;
    }
  }

  // 3. Migration Phase: Sync SEO Redirects (Cursor-based pagination using _id)
  lastId = null;
  let redirectsSyncCount = 0;

  while (true) {
    const query = lastSyncTime ? { updatedAt: { $gt: new Date(lastSyncTime) } } : {};
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await MonolithRedirect.find(query).sort({ _id: 1 }).limit(limit).lean();
    if (batch.length === 0) break;

    for (const r of batch) {
      lastId = r._id;

      if (!dryRun) {
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
      }
      redirectsSyncCount++;
    }
  }

  // 4. Migration Phase: Seed default translations from backend service file
  let translationsSyncCount = 0;
  try {
    const monolithI18n = require("../../../apps/legacy-monolith/services/i18n");
    const dictionaries = monolithI18n.dictionaries || {};

    for (const [locale, keys] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(keys)) {
        if (!dryRun) {
          await TargetTranslation.findOneAndUpdate(
            { Locale: locale, Key: key },
            { $set: { Value: String(value) } },
            { upsert: true }
          );
        }
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
  console.log(`- Target ContentPage count after: ${targetCmsCountAfter} (Processed in this run: ${pagesSyncCount})`);
  console.log(`- Target SEO Redirects count after: ${targetRedirectCountAfter} (Processed in this run: ${redirectsSyncCount})`);

  const expectedPagesCount = dryRun ? targetCmsCountBefore : Math.max(targetCmsCountBefore, sourceCmsCount);
  const expectedRedirectsCount = dryRun ? targetRedirectCountBefore : Math.max(targetRedirectCountBefore, sourceRedirectCount);

  const isCmsMatch = targetCmsCountAfter === expectedPagesCount;
  const isRedirectMatch = targetRedirectCountAfter === expectedRedirectsCount;

  console.log("[Reconciliation] Verification Summary:");
  console.log(`- CMS Pages Sync match: ${isCmsMatch ? "SUCCESS" : "MISMATCH"}`);
  console.log(`- SEO Redirects Sync match: ${isRedirectMatch ? "SUCCESS" : "MISMATCH"}`);
  console.log(`- Conflict records flagged: ${pagesConflictCount}`);

  await legacyConn.close();
  await targetConn.close();
  console.log("[Backfill] Content data reconciliation complete.");

  return {
    pagesSynced: pagesSyncCount,
    redirectsSynced: redirectsSyncCount,
    conflicts: pagesConflictCount,
    verified: isCmsMatch && isRedirectMatch,
  };
}

if (require.main === module) {
  const syncTime = process.env.LAST_SYNC_TIME || null;
  const isDry = process.env.DRY_RUN === "true";
  runBackfill(syncTime, isDry).catch(console.error);
}

module.exports = { runBackfill };
