"use strict";

const express = require("express");
const { verifyToken } = require("../middlewares/authMiddleware");
const { pushSubscriptionLimiter } = require("../middlewares/rateLimiters");

const c = require("../controllers/communicationController");
const router = express.Router();

router.get("/me/notification-prefs", verifyToken, c.getNotifyPrefs);
router.put("/me/notification-prefs", verifyToken, c.updateNotifyPrefs);

router.get("/push/vapid-public-key", c.pushVapidPublic);
router.post(
  "/push/subscribe",
  verifyToken,
  pushSubscriptionLimiter,
  c.pushSubscribe
);
router.post(
  "/push/unsubscribe",
  verifyToken,
  pushSubscriptionLimiter,
  c.pushUnsubscribe
);

module.exports = router;
