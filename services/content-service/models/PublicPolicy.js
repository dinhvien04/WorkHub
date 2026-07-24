"use strict";

const mongoose = require("mongoose");

const publicPolicySchema = new mongoose.Schema(
  {
    PolicyKey: { type: String, required: true, unique: true, index: true },
    Title: { type: String, required: true },
    Content: { type: String, required: true },
    Version: { type: String, default: "1.0.0" }
  },
  { collection: "public_policies", timestamps: true }
);

module.exports = mongoose.model("PublicPolicy", publicPolicySchema);
