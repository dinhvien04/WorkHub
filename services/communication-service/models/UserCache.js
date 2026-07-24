"use strict";

const mongoose = require("mongoose");

const userCacheSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    Email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    FullName: { type: String, required: true },
    Role: { type: String, enum: ["customer", "host", "admin"], required: true },
    Status: { type: String, enum: ["active", "inactive", "banned"], required: true },
    tokenVersion: { type: Number, default: 0 }
  },
  { collection: "users", timestamps: true }
);

module.exports = mongoose.model("UserCache", userCacheSchema);
