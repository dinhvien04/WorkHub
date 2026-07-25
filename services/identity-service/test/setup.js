"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.IDENTITY_INTERNAL_SECRET =
  "default_test_identity_internal_secret_key";
process.env.MONGODB_IDENTITY_URI =
  "mongodb://127.0.0.1:27017/test-identity-db";
process.env.RABBITMQ_URL = "amqp://localhost:5672";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

require("../models/User");
require("../models/Session");

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
  await mongoose.model("User").createCollection();
  await mongoose.model("UserSession").createCollection();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});
