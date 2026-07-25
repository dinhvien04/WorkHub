"use strict";

const NotificationPreference = require("../models/NotificationPreference");

async function getPreferences(req, res, next) {
  try {
    const userId = req.user.userId;
    let prefs = await NotificationPreference.findOne({ UserID: userId }).lean();

    if (!prefs) {
      // Default preferences if not found
      prefs = {
        UserID: userId,
        NotifyEmail: true,
        NotifyPush: true,
        NotifySms: false,
        MarketingOptIn: false,
        PreferredLang: "vi",
        Timezone: "Asia/Ho_Chi_Minh",
      };
    }

    return res.json({ preferences: prefs });
  } catch (err) {
    next(err);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const userId = req.user.userId;
    const { notifyEmail, notifyPush, notifySms, marketingOptIn, preferredLang, timezone } = req.body;

    const updates = {};
    if (notifyEmail !== undefined) updates.NotifyEmail = !!notifyEmail;
    if (notifyPush !== undefined) updates.NotifyPush = !!notifyPush;
    if (notifySms !== undefined) updates.NotifySms = !!notifySms;
    if (marketingOptIn !== undefined) updates.MarketingOptIn = !!marketingOptIn;
    if (preferredLang !== undefined) updates.PreferredLang = String(preferredLang).slice(0, 8);
    if (timezone !== undefined) updates.Timezone = String(timezone).slice(0, 64);

    const doc = await NotificationPreference.findOneAndUpdate(
      { UserID: userId },
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ message: "Cập nhật cấu hình thông báo thành công", preferences: doc });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPreferences,
  updatePreferences,
};
