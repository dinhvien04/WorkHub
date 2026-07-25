"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_at_least_32_characters_long_for_workhub";
process.env.MONGODB_COMMUNICATION_URI = "mongodb://127.0.0.1:27017/test-communication-db";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_COMMUNICATION_URI = uri;
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});
