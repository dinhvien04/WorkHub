"use strict";

const express = require("express");
const router = express.Router();
const redirectController = require("../controllers/redirectController");
const { requireAuth, requireAdmin } = require("../middlewares/auth");

router.get("/", redirectController.listRedirects);
router.get("/find", redirectController.getRedirectByPath);
router.post("/", requireAuth, requireAdmin, redirectController.upsertRedirect);
router.delete("/:id", requireAuth, requireAdmin, redirectController.deleteRedirect);

module.exports = router;
