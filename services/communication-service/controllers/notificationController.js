"use strict";

const Notification = require("../models/Notification");

async function listNotifications(req, res, next) {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50, unreadOnly = "false" } = req.query;

    const limitNum = parseInt(limit) || 50;
    const pageNum = parseInt(page) || 1;
    const skipIndex = (pageNum - 1) * limitNum;

    const query = { UserID: userId };
    if (unreadOnly === "true") {
      query.IsRead = false;
    }

    const [items, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skipIndex)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ UserID: userId, IsRead: false }),
    ]);

    return res.json({
      notifications: items,
      pagination: {
        total,
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const doc = await Notification.findOneAndUpdate(
      { _id: id, UserID: userId },
      { $set: { IsRead: true } },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({ error: "Không tìm thấy thông báo." });
    }

    return res.json({ message: "Đã đánh dấu đọc thông báo.", notification: doc });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const userId = req.user.userId;

    await Notification.updateMany(
      { UserID: userId, IsRead: false },
      { $set: { IsRead: true } }
    );

    return res.json({ message: "Đã đánh dấu đọc toàn bộ thông báo." });
  } catch (err) {
    next(err);
  }
}

async function deleteNotification(req, res, next) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const doc = await Notification.findOneAndDelete({ _id: id, UserID: userId });
    if (!doc) {
      return res.status(404).json({ error: "Không tìm thấy thông báo." });
    }

    return res.json({ message: "Đã xóa thông báo thành công." });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
  deleteNotification,
};
