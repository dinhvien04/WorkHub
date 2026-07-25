"use strict";

const mongoose = require("mongoose");
const env = require("./env");

async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  const autoIndex = env.NODE_ENV !== "test" && env.NODE_ENV !== "e2e-test";
  await mongoose.connect(env.MONGODB_IDENTITY_URI, { autoIndex });
  console.log("[Db] Connected to Identity Database successfully.");
  return mongoose.connection;
}

async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("[Db] Disconnected from Identity Database.");
  }
}

module.exports = { connectDb, disconnectDb };
