"use strict";

const pushService = require("../services/pushService");

async function getVapidPublicKey(req, res, next) {
  try {
    const key = pushService.publicVapidKey();
    return res.json({ publicKey: key });
  } catch (err) {
    next(err);
  }
}

async function subscribe(req, res, next) {
  try {
    const userId = req.user.userId;
    const { endpoint, keys, userAgent } = req.body;

    const doc = await pushService.saveSubscription({
      userId,
      endpoint,
      keys,
      userAgent: userAgent || req.get("user-agent"),
    });

    return res.status(201).json({ message: "Đăng ký push thành công", subscription: doc });
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const userId = req.user.userId;
    const { endpoint } = req.body;

    await pushService.revokeSubscription({ userId, endpoint });
    return res.json({ message: "Hủy đăng ký push thành công" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
};
