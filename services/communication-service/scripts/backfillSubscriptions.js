"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

async function runBackfill() {
  const legacyUri = process.env.MONGODB_URI;
  const targetUri = process.env.MONGODB_COMMUNICATION_URI;

  if (!legacyUri || !targetUri) {
    console.error("Missing MONGODB_URI or MONGODB_COMMUNICATION_URI environment variables.");
    process.exit(1);
  }

  const legacyConn = await mongoose.createConnection(legacyUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  // Monolith models/schemas
  const monolithUserSchema = new mongoose.Schema({}, { strict: false });
  const MonolithUser = legacyConn.model("User", monolithUserSchema, "users");

  const monolithPushSchema = new mongoose.Schema({}, { strict: false });
  const MonolithPush = legacyConn.model("PushSubscription", monolithPushSchema, "push_subscriptions");

  // Communication Service target models/schemas
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

  console.log("[Backfill] Fetching users from legacy monolith database...");
  const users = await MonolithUser.find({}).lean();
  let userCount = 0;

  for (const u of users) {
    // 1. Sync local UserCache read model
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

    // 2. Sync notification preferences (maps old settings or defaults them)
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
    userCount++;
  }
  console.log(`[Backfill] Successfully backfilled ${userCount} User read-models & preferences.`);

  console.log("[Backfill] Fetching active push subscriptions from legacy database...");
  const subscriptions = await MonolithPush.find({ Status: "active" }).lean();
  let pushCount = 0;

  for (const s of subscriptions) {
    if (!s.Endpoint || !s.Keys || !s.Keys.p256dh || !s.Keys.auth) {
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
    pushCount++;
  }
  console.log(`[Backfill] Successfully backfilled ${pushCount} Push subscriptions.`);

  await legacyConn.close();
  await targetConn.close();
  console.log("[Backfill] Databases closed. Done.");
}

if (require.main === module) {
  runBackfill().catch(console.error);
}

module.exports = { runBackfill };
