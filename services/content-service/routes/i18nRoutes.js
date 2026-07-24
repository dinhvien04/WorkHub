"use strict";

const express = require("express");
const router = express.Router();
const i18nController = require("../controllers/i18nController");
const { requireAuth, requireAdmin } = require("../middlewares/auth");

router.get("/", i18nController.getTranslationBundle);
router.post("/", requireAuth, requireAdmin, i18nController.upsertTranslation);

module.exports = router;
