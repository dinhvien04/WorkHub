"use strict";

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");

dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config();

function computeUserChecksum(doc) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        Email: doc.Email,
        FullName: doc.FullName,
        Role: doc.Role,
        Status: doc.Status,
        tokenVersion: doc.tokenVersion || 0,
        AuthProvider: doc.AuthProvider || "local",
        EmailVerified: !!doc.EmailVerified,
      }),
    )
    .digest("hex");
}

async function runBackfill({ dryRun = false } = {}) {
  const legacyUri = process.env.MONGODB_URI;
  const targetUri = process.env.MONGODB_IDENTITY_URI;
  if (!legacyUri || !targetUri) {
    throw new Error("Missing MONGODB_URI or MONGODB_IDENTITY_URI");
  }

  const legacyConn = await mongoose.createConnection(legacyUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  const SourceUser = legacyConn.model(
    "User",
    new mongoose.Schema({}, { strict: false }),
    "users",
  );
  const TargetUser = targetConn.model(
    "User",
    new mongoose.Schema({}, { strict: false }),
    "users",
  );

  const SourceSession = legacyConn.model(
    "UserSession",
    new mongoose.Schema({}, { strict: false }),
    "user_sessions",
  );
  const TargetSession = targetConn.model(
    "UserSession",
    new mongoose.Schema({}, { strict: false }),
    "user_sessions",
  );

  const sourceUsers = await SourceUser.find({}).lean();
  let usersUpserted = 0;
  for (const u of sourceUsers) {
    if (dryRun) {
      usersUpserted += 1;
      continue;
    }
    await TargetUser.findOneAndUpdate(
      { Email: u.Email },
      {
        $set: {
          Email: u.Email,
          PasswordHash: u.PasswordHash,
          AuthProvider: u.AuthProvider || "local",
          GoogleSub: u.GoogleSub,
          FullName: u.FullName,
          Role: u.Role,
          Status: u.Status,
          tokenVersion: u.tokenVersion || 0,
          EmailVerified: !!u.EmailVerified,
          EmailVerifiedAt: u.EmailVerifiedAt || null,
          TotpEnabled: !!u.TotpEnabled,
          TotpSecret: u.TotpSecret || null,
          TotpRecoveryHashes: u.TotpRecoveryHashes || [],
          NotifyEmail: u.NotifyEmail !== false,
          NotifyPush: u.NotifyPush !== false,
          NotifySms: !!u.NotifySms,
          MarketingOptIn: !!u.MarketingOptIn,
          PreferredLang: u.PreferredLang || "vi",
          Timezone: u.Timezone || "Asia/Ho_Chi_Minh",
          Checksum: computeUserChecksum(u),
        },
      },
      { upsert: true, new: true },
    );
    usersUpserted += 1;
  }

  const sourceSessions = await SourceSession.find({}).lean();
  let sessionsUpserted = 0;
  for (const s of sourceSessions) {
    if (!s.SidHash || !s.PublicSessionID) continue;
    if (dryRun) {
      sessionsUpserted += 1;
      continue;
    }
    await TargetSession.findOneAndUpdate(
      { SidHash: s.SidHash },
      {
        $set: {
          UserID: s.UserID,
          PublicSessionID: s.PublicSessionID,
          SidHash: s.SidHash,
          TokenVersion: s.TokenVersion || 0,
          UserAgent: s.UserAgent || "",
          IP: s.IP || "",
          AuthMethod: s.AuthMethod || "unknown",
          LastSeenAt: s.LastSeenAt || new Date(),
          ExpiresAt: s.ExpiresAt || null,
          RevokedAt: s.RevokedAt || null,
        },
      },
      { upsert: true, new: true },
    );
    sessionsUpserted += 1;
  }

  const result = {
    dryRun,
    usersSource: sourceUsers.length,
    usersUpserted,
    sessionsSource: sourceSessions.length,
    sessionsUpserted,
  };

  await legacyConn.close();
  await targetConn.close();
  return result;
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  runBackfill({ dryRun })
    .then((r) => {
      console.log("[IdentityBackfill] complete", r);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[IdentityBackfill] failed", err.message);
      process.exit(1);
    });
}

module.exports = { runBackfill, computeUserChecksum };
