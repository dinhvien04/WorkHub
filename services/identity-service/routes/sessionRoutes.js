"use strict";

const express = require("express");
const { verifyToken } = require("../middlewares/auth");
const {
  listSessions,
  revokeSession,
  logoutAll,
} = require("../controllers/sessionController");

const router = express.Router();

router.get("/sessions", verifyToken, listSessions);
router.delete("/sessions/:id", verifyToken, revokeSession);
router.post("/sessions/logout-all", verifyToken, logoutAll);

module.exports = router;
