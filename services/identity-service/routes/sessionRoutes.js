"use strict";

const express = require("express");
const { requireAuth, requireAdmin } = require("../middlewares/auth");
const {
  listSessions,
  revokeSession,
  logoutAll,
  adminForceLogout,
} = require("../controllers/sessionController");

const router = express.Router();

router.get("/sessions", requireAuth, listSessions);
router.delete("/sessions/:id", requireAuth, revokeSession);
router.post("/sessions/logout-all", requireAuth, logoutAll);
router.post("/admin/users/:userId/force-logout", requireAuth, requireAdmin, adminForceLogout);

module.exports = router;
