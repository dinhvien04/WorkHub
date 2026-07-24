"use strict";

const express = require("express");
const router = express.Router();
const pushController = require("../controllers/pushController");
const { requireAuth } = require("../middlewares/auth");

router.get("/vapid-public-key", pushController.getVapidPublicKey);
router.post("/subscribe", requireAuth, pushController.subscribe);
router.post("/unsubscribe", requireAuth, pushController.unsubscribe);

module.exports = router;
