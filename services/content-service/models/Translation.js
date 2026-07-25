"use strict";

const mongoose = require("mongoose");

const translationSchema = new mongoose.Schema(
  {
    Locale: { type: String, required: true, index: true },
    Key: { type: String, required: true },
    Value: { type: String, required: true },
    Version: { type: Number, default: 1 }
  },
  { collection: "translations", timestamps: true }
);

// Unique translation key per locale
translationSchema.index({ Locale: 1, Key: 1 }, { unique: true });

module.exports = mongoose.model("Translation", translationSchema);
