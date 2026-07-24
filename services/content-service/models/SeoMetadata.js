"use strict";

const mongoose = require("mongoose");

const seoMetadataSchema = new mongoose.Schema(
  {
    Path: { type: String, required: true, unique: true, trim: true, index: true },
    Title: { type: String, default: "" },
    Description: { type: String, default: "" },
    Keywords: { type: String, default: "" },
    OpenGraph: {
      Title: { type: String, default: "" },
      Description: { type: String, default: "" },
      Image: { type: String, default: "" }
    }
  },
  { collection: "seo_metadata", timestamps: true }
);

module.exports = mongoose.model("SeoMetadata", seoMetadataSchema);
