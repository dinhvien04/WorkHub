"use strict";

const asyncHandler = require("../utils/asyncHandler");
const User = require("../models/User");
const pushService = require("../services/pushService");

// —— Notification preferences ——
const getNotifyPrefs = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId)
    .select(
      "NotifyEmail NotifyPush NotifySms MarketingOptIn PreferredLang Timezone",
    )
    .lean();
  res.json({
    prefs: {
      email: user?.NotifyEmail !== false,
      push: user?.NotifyPush !== false,
      sms: !!user?.NotifySms,
      marketing: !!user?.MarketingOptIn,
      lang: user?.PreferredLang || "vi",
      timezone: user?.Timezone || "Asia/Ho_Chi_Minh",
    },
  });
});

const updateNotifyPrefs = asyncHandler(async (req, res) => {
  const updates = {};
  if (typeof req.body.email === "boolean") updates.NotifyEmail = req.body.email;
  if (typeof req.body.push === "boolean") updates.NotifyPush = req.body.push;
  if (typeof req.body.sms === "boolean") updates.NotifySms = req.body.sms;
  if (typeof req.body.marketing === "boolean")
    updates.MarketingOptIn = req.body.marketing;
  if (req.body.lang) updates.PreferredLang = String(req.body.lang).slice(0, 8);
  if (req.body.timezone)
    updates.Timezone = String(req.body.timezone).slice(0, 64);
  const user = await User.findByIdAndUpdate(
    req.user.userId,
    { $set: updates },
    { new: true },
  )
    .select(
      "NotifyEmail NotifyPush NotifySms MarketingOptIn PreferredLang Timezone",
    )
    .lean();
  res.json({ prefs: user });
});

// —— Web Push ——
const pushVapidPublic = asyncHandler(async (req, res) => {
  res.json({ publicKey: pushService.publicVapidKey() });
});

const pushSubscribe = asyncHandler(async (req, res) => {
  const sub = await pushService.saveSubscription({
    userId: req.user.userId,
    endpoint: req.body.endpoint,
    keys: req.body.keys || {},
    userAgent: req.get("user-agent"),
  });
  res.status(201).json({ subscription: { id: sub._id } });
});

const pushUnsubscribe = asyncHandler(async (req, res) => {
  await pushService.revokeSubscription({
    userId: req.user.userId,
    endpoint: req.body.endpoint,
  });
  res.json({ message: "Đã hủy đăng ký push." });
});

module.exports = {
  getNotifyPrefs,
  updateNotifyPrefs,
  pushVapidPublic,
  pushSubscribe,
  pushUnsubscribe,
};
