"use strict";

const mongoose = require("mongoose");
const env = require("./env");

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const options = {
    autoIndex: true,
  };

  try {
    console.log("[Db] Connecting to Content Database...");
    await mongoose.connect(env.MONGODB_CONTENT_URI, options);
    console.log("[Db] Connected to Content Database successfully.");
    return mongoose.connection;
  } catch (err) {
    console.error("[Db] Connection to Content Database failed:", err.message);
    throw err;
  }
}

async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("[Db] Disconnected from Content Database.");
  }
}

module.exports = {
  connectDb,
  disconnectDb,
};
