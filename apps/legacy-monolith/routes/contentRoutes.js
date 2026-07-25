"use strict";

const express = require("express");
const {
  verifyToken,
  requireAdmin,
  optionalAuth,
} = require("../middlewares/authMiddleware");

const c = require("../controllers/contentController");
const router = express.Router();

// General / Customer Content routes
router.get("/cms", c.listCms);
router.get("/cms/:slug", c.getCms);
router.get("/flags", c.flags);

router.get("/i18n", c.i18nBundle);
router.post("/i18n/lang", optionalAuth, c.setLang);
router.put("/i18n/lang", optionalAuth, c.setLang);
router.get("/privacy/policy", c.privacyPolicy);

// Admin Content routes
router.post("/admin/cms", verifyToken, requireAdmin, c.upsertCms);
router.get("/admin/flags", verifyToken, requireAdmin, c.adminListFlags);
router.put("/admin/flags", verifyToken, requireAdmin, c.adminUpsertFlag);

module.exports = router;
