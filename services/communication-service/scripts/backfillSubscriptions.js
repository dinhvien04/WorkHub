"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

async function runBackfill(lastSyncTime = null) {
  const legacyUri = process.env.MONGODB_URI;
  const targetUri = process.env.MONGODB_COMMUNICATION_URI;

  if (!legacyUri || !targetUri) {
    console.error("Missing MONGODB_URI or MONGODB_COMMUNICATION_URI environment variables.");
    process.exit(1);
  }

  const legacyConn = await mongoose.createConnection(legacyUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  // Schemas
  const monolithUserSchema = new mongoose.Schema({}, { strict: false });
  const MonolithUser = legacyConn.model("User", monolithUserSchema, "users");

  const monolithPushSchema = new mongoose.Schema({}, { strict: false });
  const MonolithPush = legacyConn.model("PushSubscription", monolithPushSchema, "push_subscriptions");

  const userCacheSchema = new mongoose.Schema({
    Email: String,
    FullName: String,
    Role: String,
    Status: String,
    tokenVersion: Number,
  }, { strict: false });
  const TargetUserCache = targetConn.model("UserCache", userCacheSchema, "users");

  const preferenceSchema = new mongoose.Schema({
    UserID: mongoose.Schema.Types.ObjectId,
    NotifyEmail: Boolean,
    NotifyPush: Boolean,
    NotifySms: Boolean,
    MarketingOptIn: Boolean,
    PreferredLang: String,
    Timezone: String,
  }, { strict: false });
  const TargetPreference = targetConn.model("NotificationPreference", preferenceSchema, "notification_preferences");

  const pushSubscriptionSchema = new mongoose.Schema({
    UserID: mongoose.Schema.Types.ObjectId,
    Endpoint: String,
    Keys: { p256dh: String, auth: String },
    UserAgent: String,
    Status: String,
  }, { strict: false });
  const TargetPush = targetConn.model("PushSubscription", pushSubscriptionSchema, "push_subscriptions");

  // 1. Reconciliation Phase: Count records before backfill
  const sourceUserCount = await MonolithUser.countDocuments({});
  const sourcePushCountBefore = await MonolithPush.countDocuments({ Status: "active" });

  const targetUserCountBefore = await TargetUserCache.countDocuments({});
  const targetPushCountBefore = await TargetPush.countDocuments({ Status: "active" });

  console.log("[Reconciliation] Pre-migration Statistics:");
  console.log(`- Monolith User count: ${sourceUserCount}`);
  console.log(`- Target UserCache count: ${targetUserCountBefore}`);
  console.log(`- Monolith Active Push Subscriptions: ${sourcePushCountBefore}`);
  console.log(`- Target Active Push Subscriptions: ${targetPushCountBefore}`);

  // 2. Migration Phase: Sync Users
  const userFilter = {};
  if (lastSyncTime) {
    userFilter.updatedAt = { $gt: new Date(lastSyncTime) };
    console.log(`[Backfill] Processing user deltas updated after: ${lastSyncTime}`);
  }

  const users = await MonolithUser.find(userFilter).lean();
  let userSyncCount = 0;

  for (const u of users) {
    await TargetUserCache.findByIdAndUpdate(
      u._id,
      {
        $set: {
          Email: u.Email,
          FullName: u.FullName,
          Role: u.Role,
          Status: u.Status,
          tokenVersion: u.tokenVersion || 0,
        },
      },
      { upsert: true }
    );

    await TargetPreference.findOneAndUpdate(
      { UserID: u._id },
      {
        $set: {
          NotifyEmail: u.NotifyEmail !== false,
          NotifyPush: u.NotifyPush !== false,
          NotifySms: !!u.NotifySms,
          MarketingOptIn: !!u.MarketingOptIn,
          PreferredLang: u.PreferredLang || "vi",
          Timezone: u.Timezone || "Asia/Ho_Chi_Minh",
        },
      },
      { upsert: true }
    );
    userSyncCount++;
  }

  // 3. Migration Phase: Sync Push Subscriptions (Deltas supported)
  const pushFilter = { Status: "active" };
  if (lastSyncTime) {
    pushFilter.updatedAt = { $gt: new Date(lastSyncTime) };
    console.log(`[Backfill] Processing push subscription deltas updated after: ${lastSyncTime}`);
  }

  const subscriptions = await MonolithPush.find(pushFilter).lean();
  let pushSyncCount = 0;

  for (const s of subscriptions) {
    if (!s.Endpoint || !s.Keys || !s.Keys.p256dh || !s.Keys.auth) {
      // Redact Endpoint and Keys in warnings to avoid secrets leaks
      console.warn(`[Backfill] Skipping invalid push subscription ID: ${s._id}`);
      continue;
    }

    await TargetPush.findOneAndUpdate(
      { UserID: s.UserID, Endpoint: s.Endpoint },
      {
        $set: {
          Keys: {
            p256dh: s.Keys.p256dh,
            auth: s.Keys.auth,
          },
          UserAgent: s.UserAgent || "",
          Status: s.Status || "active",
        },
      },
      { upsert: true }
    );
    pushSyncCount++;
  }

  // 4. Reconciliation Phase: Count records after backfill and compare
  const targetUserCountAfter = await TargetUserCache.countDocuments({});
  const targetPushCountAfter = await TargetPush.countDocuments({ Status: "active" });

  console.log("[Reconciliation] Post-migration Statistics:");
  console.log(`- Target UserCache count after: ${targetUserCountAfter} (Synced in this run: ${userSyncCount})`);
  console.log(`- Target Active Push Subscriptions after: ${targetPushCountAfter} (Synced in this run: ${pushSyncCount})`);

  // Verify counts match source of truth
  const isUserMatch = targetUserCountAfter === sourceUserCount;
  const isPushMatch = targetPushCountAfter === sourcePushCountBefore;

  console.log("[Reconciliation] Verification Summary:");
  console.log(`- Users Sync match: ${isUserMatch ? "SUCCESS (Counts match)" : "MISMATCH"}`);
  console.log(`- Push Subscriptions Sync match: ${isPushMatch ? "SUCCESS (Counts match)" : "MISMATCH"}`);

  await legacyConn.close();
  await targetConn.close();
  console.log("[Backfill] Data reconciliation complete.");

  return {
    usersSynced: userSyncCount,
    pushSynced: pushSyncCount,
    verified: isUserMatch && isPushMatch,
  };
}

if (require.main === module) {
  const syncTime = process.env.LAST_SYNC_TIME || null;
  runBackfill(syncTime).catch(console.error);
}

module.exports = { runBackfill };
