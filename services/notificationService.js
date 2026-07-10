'use strict';

const Notification = require('../models/Notification');
const logger = require('../utils/logger');

async function notifyUser({
  userId,
  title,
  body = '',
  type = 'system',
  entityType = '',
  entityId = null,
  link = '',
}) {
  try {
    const doc = await Notification.create({
      UserID: userId,
      Title: title,
      Body: body,
      Type: type,
      EntityType: entityType,
      EntityID: entityId,
      Link: link,
    });
    try {
      const { getIO } = require('./socketService');
      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit('notification', {
          id: doc._id,
          title,
          body,
          type,
          link,
        });
      }
    } catch {
      /* socket optional */
    }
    return doc;
  } catch (err) {
    logger.error('notifyUser failed', err.message);
    return null;
  }
}

async function listNotifications(
  userId,
  { page = 1, limit = 20, unreadOnly = false, type = null } = {}
) {
  const filter = { UserID: userId };
  if (unreadOnly) filter.IsRead = false;
  if (type && ['system', 'booking', 'payment', 'host', 'admin', 'message'].includes(type)) {
    filter.Type = type;
  }
  const skip = (page - 1) * limit;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ UserID: userId, IsRead: false }),
  ]);
  return { items, total, unreadCount, page, limit };
}

async function markRead(userId, notificationId) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, UserID: userId },
    { $set: { IsRead: true } },
    { returnDocument: 'after' }
  );
}

async function markAllRead(userId) {
  await Notification.updateMany({ UserID: userId, IsRead: false }, { $set: { IsRead: true } });
}

async function unreadCount(userId) {
  return Notification.countDocuments({ UserID: userId, IsRead: false });
}

async function deleteNotification(userId, notificationId) {
  return Notification.findOneAndDelete({ _id: notificationId, UserID: userId });
}

module.exports = {
  notifyUser,
  listNotifications,
  markRead,
  markAllRead,
  unreadCount,
  deleteNotification,
};
