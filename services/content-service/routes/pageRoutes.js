"use strict";

const express = require("express");
const router = express.Router();
const pageController = require("../controllers/pageController");
const { requireAuth, requireAdmin } = require("../middlewares/auth");

router.get("/", pageController.listPages);
router.get("/:slug", pageController.getPage);
router.post("/", requireAuth, requireAdmin, pageController.upsertPage);
router.delete("/:slug", requireAuth, requireAdmin, pageController.deletePage);

module.exports = router;
