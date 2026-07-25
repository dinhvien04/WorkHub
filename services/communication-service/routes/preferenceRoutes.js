"use strict";

const express = require("express");
const router = express.Router();
const preferenceController = require("../controllers/preferenceController");
const { requireAuth } = require("../middlewares/auth");

router.use(requireAuth);

router.get("/", preferenceController.getPreferences);
router.put("/", preferenceController.updatePreferences);

module.exports = router;
