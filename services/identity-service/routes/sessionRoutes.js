"use strict";

const express = require("express");
const { verifyToken, requireAdmin } = require("../middlewares/auth");
const {
  listSessions,
  revokeSession,
  logoutAll,
  adminForceLogout,
} = require("../controllers/sessionController");

const router = express.Router();

router.get("/sessions", verifyToken, listSessions);
router.delete("/sessions/:id", verifyToken, revokeSession);
router.post("/sessions/logout-all", verifyToken, logoutAll);
router.post("/admin/users/:userId/force-logout", verifyToken, requireAdmin, adminForceLogout);

module.exports = router;
