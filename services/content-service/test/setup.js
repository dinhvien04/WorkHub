"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.CONTENT_INTERNAL_SECRET = "default_test_content_internal_secret_key";
process.env.MONGODB_CONTENT_URI = "mongodb://127.0.0.1:27017/test-content-db";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// Load models to register schemas
require("../models/ContentPage");
require("../models/SeoRedirect");
require("../models/Translation");
require("../models/AuditLog");
require("../models/ContentOutbox");
require("../models/ProcessedMessage");

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replset.getUri();
  process.env.MONGODB_CONTENT_URI = uri;
  await mongoose.connect(uri);
  await mongoose.connection.db.admin().command({ ping: 1 });

  // Pre-create collections to prevent catalog change transaction aborts in replica set
  await mongoose.model("ContentPage").createCollection();
  await mongoose.model("SeoRedirect").createCollection();
  await mongoose.model("Translation").createCollection();
  await mongoose.model("AuditLog").createCollection();
  await mongoose.model("ContentOutbox").createCollection();
  await mongoose.model("ProcessedMessage").createCollection();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) {
    await replset.stop();
  }
});
