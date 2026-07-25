"use strict";

const express = require("express");
const { verifyToken } = require("../middlewares/auth");
const c = require("../controllers/authController");

const router = express.Router();

router.post("/register", c.register);
router.post("/login", c.login);
router.post("/logout", verifyToken, c.logout);
router.get("/me", verifyToken, c.me);

module.exports = router;
