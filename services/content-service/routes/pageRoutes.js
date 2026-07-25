"use strict";

const express = require("express");
const router = express.Router();
const pageController = require("../controllers/pageController");
const { requireAuth, requireScope } = require("../middlewares/auth");

router.get("/", pageController.listPages);
router.get("/:slug", pageController.getPage);

// Mutating page endpoints require auth and specific scopes
router.post("/", requireAuth, requireScope("content:write"), pageController.upsertPage);
router.delete("/:slug", requireAuth, requireScope("content:write"), pageController.deletePage);

module.exports = router;
