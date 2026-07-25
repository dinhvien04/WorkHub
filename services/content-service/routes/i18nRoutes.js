"use strict";

const express = require("express");
const router = express.Router();
const i18nController = require("../controllers/i18nController");
const { requireAuth, requireScope } = require("../middlewares/auth");

router.get("/", i18nController.getTranslationBundle);

// Mutating translation endpoints require i18n:manage scope
router.post("/", requireAuth, requireScope("content:i18n:manage"), i18nController.upsertTranslation);

module.exports = router;
