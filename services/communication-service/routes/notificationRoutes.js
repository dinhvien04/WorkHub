"use strict";

const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { requireAuth } = require("../middlewares/auth");

router.use(requireAuth);

router.get("/", notificationController.listNotifications);
router.patch("/:id/read", notificationController.markRead);
router.post("/read-all", notificationController.markAllRead);
router.delete("/:id", notificationController.deleteNotification);

module.exports = router;
