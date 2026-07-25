"use strict";

const mongoose = require("mongoose");

const preferenceSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    NotifyEmail: { type: Boolean, default: true },
    NotifyPush: { type: Boolean, default: true },
    NotifySms: { type: Boolean, default: false },
    MarketingOptIn: { type: Boolean, default: false },
    PreferredLang: { type: String, default: "vi", maxlength: 8 },
    Timezone: { type: String, default: "Asia/Ho_Chi_Minh", maxlength: 64 }
  },
  { collection: "notification_preferences", timestamps: true }
);

module.exports = mongoose.model("NotificationPreference", preferenceSchema);
