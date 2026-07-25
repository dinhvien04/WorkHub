"use strict";

const mongoose = require("mongoose");
const env = require("./env");

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const options = {
    autoIndex: env.NODE_ENV !== "test" && env.NODE_ENV !== "e2e-test",
  };

  try {
    console.log("[Db] Connecting to Communication Database...");
    await mongoose.connect(env.MONGODB_COMMUNICATION_URI, options);
    console.log("[Db] Connected to Communication Database successfully.");
    return mongoose.connection;
  } catch (err) {
    console.error("[Db] Connection to Communication Database failed:", err.message);
    throw err;
  }
}

async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("[Db] Disconnected from Communication Database.");
  }
}

module.exports = {
  connectDb,
  disconnectDb,
};
