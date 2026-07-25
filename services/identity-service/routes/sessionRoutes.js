"use strict";

const express = require("express");
const { verifyToken } = require("../middlewares/auth");
const c = require("../controllers/authController");

const router = express.Router();

router.get("/sessions", verifyToken, c.listSessions);
router.delete("/sessions/:id", verifyToken, c.revokeSession);
router.post("/sessions/logout-all", verifyToken, c.logoutAll);

module.exports = router;
