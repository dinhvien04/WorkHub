"use strict";

const asyncHandler = require("../utils/asyncHandler");
const cmsService = require("../services/cmsService");
const featureFlagService = require("../services/featureFlagService");
const { detectLang } = require("../services/i18n");
const User = require("../models/User");

// —— CMS ——
const listCms = asyncHandler(async (req, res) => {
  const data = await cmsService.listPublished(req.query);
  res.json(data);
});

const getCms = asyncHandler(async (req, res) => {
  const page = await cmsService.getBySlug(req.params.slug);
  res.json({ page });
});

const upsertCms = asyncHandler(async (req, res) => {
  const page = await cmsService.upsertPage(req.body, req.user.userId);
  res.json({ page });
});

// —— Feature flags ——
const flags = asyncHandler(async (req, res) => {
  const map = await featureFlagService.listPublicFlags({
    userId: req.user?.userId || null,
    role: req.user?.role || null,
  });
  res.json({ flags: map });
});

const adminListFlags = asyncHandler(async (req, res) => {
  res.json({ flags: await featureFlagService.listAllFlags() });
});

const adminUpsertFlag = asyncHandler(async (req, res) => {
  const flag = await featureFlagService.upsertFlag({
    key: req.body.key,
    enabled: req.body.enabled,
    description: req.body.description || "",
    percentage: req.body.percentage,
    roles: req.body.roles || [],
    environments: req.body.environments || [],
  });
  res.json({ flag });
});

// —— i18n ——
const i18nBundle = asyncHandler(async (req, res) => {
  const lang = detectLang(req);
  res.json({
    lang,
    messages:
      require("../services/i18n").dictionaries[lang] ||
      require("../services/i18n").dictionaries.vi,
  });
});

const setLang = asyncHandler(async (req, res) => {
  const { setLangCookie } = require("../services/i18n");
  const lang = setLangCookie(res, req.body.lang || req.query.lang || "vi");
  if (req.user?.userId) {
    try {
      await User.findByIdAndUpdate(req.user.userId, {
        $set: { PreferredLang: lang },
      });
    } catch {
      /* ignore */
    }
  }
  res.json({ lang, messages: require("../services/i18n").dictionaries[lang] });
});

// —— Consent / policy ——
const privacyPolicy = asyncHandler(async (req, res) => {
  res.json({
    version: "2026-07",
    marketingOptInDefault: false,
    dataRetention:
      "Booking/payment retained for accounting; account soft-delete supported.",
    contact: "privacy@workhub.local",
  });
});

module.exports = {
  listCms,
  getCms,
  upsertCms,
  flags,
  adminListFlags,
  adminUpsertFlag,
  i18nBundle,
  setLang,
  privacyPolicy,
};
