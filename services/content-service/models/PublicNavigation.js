"use strict";

const mongoose = require("mongoose");

const publicNavigationSchema = new mongoose.Schema(
  {
    MenuKey: { type: String, required: true, index: true },
    Items: [
      {
        Label: { type: String, required: true },
        Link: { type: String, required: true },
        Icon: { type: String, default: "" },
        Order: { type: Number, default: 0 }
      }
    ]
  },
  { collection: "public_navigation", timestamps: true }
);

module.exports = mongoose.model("PublicNavigation", publicNavigationSchema);
