"use strict";

const express = require("express");
const router = express.Router();
const redirectController = require("../controllers/redirectController");
const { requireAuth, requireScope } = require("../middlewares/auth");

router.get("/", redirectController.listRedirects);
router.get("/find", redirectController.getRedirectByPath);

// Mutating redirect endpoints require redirect:manage scope
router.post("/", requireAuth, requireScope("content:redirect:manage"), redirectController.upsertRedirect);
router.delete("/:id", requireAuth, requireScope("content:redirect:manage"), redirectController.deleteRedirect);

module.exports = router;
