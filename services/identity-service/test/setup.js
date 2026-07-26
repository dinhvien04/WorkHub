"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.IDENTITY_INTERNAL_SECRET =
  "default_test_identity_internal_secret_key";
process.env.MONGODB_IDENTITY_URI =
  "mongodb://127.0.0.1:27017/test-identity-db";
process.env.RABBITMQ_URL = "amqp://localhost:5672";
process.env.WEBAUTHN_ENABLED = "false";
process.env.ALLOW_GOOGLE_MOCK = "true";

// Distinct per-purpose secrets, mirroring the production requirement that none
// of these may be derived from JWT_SECRET.
process.env.IDENTITY_PREAUTH_JWT_SECRET =
  "test_preauth_2fa_signing_secret_distinct_from_jwt_secret";
process.env.IDENTITY_CSRF_SECRET =
  "test_identity_csrf_secret_distinct_from_jwt_secret";
process.env.PASSWORD_RESET_PEPPER =
  "test_password_reset_pepper_distinct_from_jwt_secret";
process.env.IDENTITY_TOTP_ENCRYPTION_KEY =
  "1".repeat(64);
process.env.IDENTITY_TOTP_KEY_VERSION = "v1";
process.env.IDENTITY_OUTBOX_PAYLOAD_ENCRYPTION_KEY = "2".repeat(64);
process.env.IDENTITY_OUTBOX_PAYLOAD_KEY_VERSION = "v1";
process.env.IDENTITY_ALLOWED_ORIGINS = "http://localhost:3000";

// Legacy monolith tokens stay acceptable in tests unless a case opts out.
process.env.IDENTITY_LEGACY_JWT_ENABLED = "true";

// The outbox publisher is pumped explicitly by tests; no broker in unit runs.
process.env.DISABLE_MQ = "true";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

require("../models/User");
require("../models/Session");
require("../models/PasswordResetToken");
require("../models/EmailVerificationToken");
require("../models/WebAuthnChallenge");
require("../models/WebAuthnCredential");
require("../models/PendingAuthToken");
require("../models/IdentityOutbox");
require("../models/AuditLog");

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replset.getUri();
  process.env.MONGODB_IDENTITY_URI = uri;
  await mongoose.connect(uri);
  await mongoose.connection.db.admin().command({ ping: 1 });

  const collections = [
    "User",
    "UserSession",
    "PasswordResetToken",
    "EmailVerificationToken",
    "WebAuthnChallenge",
    "WebAuthnCredential",
    "PendingAuthToken",
    "IdentityOutbox",
    "IdentityAuditLog",
  ];
  for (const name of collections) {
    try {
      await mongoose.model(name).createCollection();
    } catch {
      /* already exists */
    }
  }
  // Unique indexes (outbox idempotency, jti) must exist for the concurrency
  // tests to mean anything.
  await Promise.all(
    collections.map((name) => mongoose.model(name).createIndexes().catch(() => {})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});
