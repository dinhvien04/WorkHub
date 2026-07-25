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

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

require("../models/User");
require("../models/Session");
require("../models/PasswordResetToken");
require("../models/EmailVerificationToken");
require("../models/WebAuthnChallenge");
require("../models/WebAuthnCredential");

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
  ];
  for (const name of collections) {
    try {
      await mongoose.model(name).createCollection();
    } catch {
      /* already exists */
    }
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});
