'use strict';

const asyncHandler = require('../utils/asyncHandler');
const favoriteService = require('../services/favoriteService');
const notificationService = require('../services/notificationService');
const messagingService = require('../services/messagingService');
const couponService = require('../services/couponService');
const calendarService = require('../services/calendarService');
const Booking = require('../models/Booking');
const { parsePagination, paginationMeta } = require('../utils/pagination');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

const listFavorites = asyncHandler(async (req, res) => {
  const items = await favoriteService.listFavorites(req.user.userId);
  res.json({ favorites: items });
});

const addFavorite = asyncHandler(async (req, res) => {
  const fav = await favoriteService.addFavorite(req.user.userId, req.body.branchId);
  res.status(201).json({ message: 'Đã thêm yêu thích.', favorite: fav });
});

const removeFavorite = asyncHandler(async (req, res) => {
  await favoriteService.removeFavorite(req.user.userId, req.params.branchId);
  res.json({ message: 'Đã xóa khỏi yêu thích.' });
});

const mergeFavorites = asyncHandler(async (req, res) => {
  const result = await favoriteService.mergeGuestFavorites(
    req.user.userId,
    req.body.branchIds || []
  );
  res.json(result);
});

const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const data = await notificationService.listNotifications(req.user.userId, {
    page,
    limit,
    unreadOnly: req.query.unread === '1',
    type: req.query.type || null,
  });
  res.json({
    notifications: data.items,
    unreadCount: data.unreadCount,
    pagination: paginationMeta(data.total, page, limit),
  });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const n = await notificationService.markRead(req.user.userId, req.params.id);
  if (!n) throw new NotFoundError('Không tìm thấy thông báo.');
  res.json({ notification: n });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.userId);
  res.json({ message: 'Đã đánh dấu đọc tất cả.' });
});

const notificationUnreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user.userId);
  res.json({ unreadCount: count });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const n = await notificationService.deleteNotification(req.user.userId, req.params.id);
  if (!n) throw new NotFoundError('Không tìm thấy thông báo.');
  res.json({ deleted: true });
});

const previewCoupon = asyncHandler(async (req, res) => {
  const { code, orderAmount, branchId, hostId } = req.body;
  const result = await couponService.validateCoupon({
    code,
    userId: req.user.userId,
    orderAmount: Number(orderAmount) || 0,
    branchId,
    hostId,
  });
  res.json({
    code: result.coupon.Code,
    discountAmount: result.discountAmount,
    finalAmount: result.finalAmount,
    type: result.coupon.Type,
    value: result.coupon.Value,
  });
});

const listMessages = asyncHandler(async (req, res) => {
  const data = await messagingService.listMessages(
    req.params.bookingId,
    req.user.userId,
    req.user.role
  );
  res.json(data);
});

const sendMessage = asyncHandler(async (req, res) => {
  const msg = await messagingService.sendMessage(
    req.params.bookingId,
    req.user.userId,
    req.user.role,
    req.body.body
  );
  res.status(201).json({ message: msg });
});

const downloadIcs = asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.bookingId,
    CustomerID: req.user.userId,
  });
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');
  const ics = calendarService.bookingToIcs(booking);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workhub-${booking._id}.ics"`);
  res.send(ics);
});

/** GDPR-style data export (JSON). No password hashes or payment card data. */
const exportMyData = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const User = require('../models/User');
  const PaymentHistory = require('../models/Payment_History');
  const Favorite = require('../models/Favorite');
  const Notification = require('../models/Notification');

  const [user, bookings, payments, favorites, notifications] = await Promise.all([
    User.findById(userId).select('-PasswordHash -tokenVersion').lean(),
    Booking.find({ CustomerID: userId }).sort({ createdAt: -1 }).limit(200).lean(),
    PaymentHistory.find({ CustomerID: userId }).sort({ createdAt: -1 }).limit(200).lean(),
    Favorite.find({ UserID: userId }).lean(),
    Notification.find({ UserID: userId }).sort({ createdAt: -1 }).limit(100).lean(),
  ]);

  if (!user) throw new NotFoundError('Người dùng không tồn tại.');

  const payload = {
    exportedAt: new Date().toISOString(),
    user,
    bookings,
    payments: payments.map((p) => ({
      id: p._id,
      bookingId: p.BookingID,
      amount: p.Amount,
      status: p.Status,
      method: p.PaymentMethod,
      createdAt: p.createdAt,
    })),
    favorites,
    notifications: notifications.map((n) => ({
      id: n._id,
      title: n.Title,
      body: n.Body,
      type: n.Type,
      isRead: n.IsRead,
      createdAt: n.createdAt,
    })),
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="workhub-my-data.json"');
  res.send(JSON.stringify(payload, null, 2));
});

/** Soft delete request — ban account + bump tokenVersion; financial rows retained. */
const requestDeleteAccount = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  const user = await User.findById(req.user.userId);
  if (!user) throw new NotFoundError('Người dùng không tồn tại.');

  user.Status = 'banned';
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.FullName = user.FullName || 'Deleted User';
  await user.save();

  try {
    const UserSession = require('../models/Session');
    await UserSession.updateMany(
      { UserID: user._id, RevokedAt: null },
      { $set: { RevokedAt: new Date() } }
    );
  } catch {
    /* ignore */
  }

  res.clearCookie(require('../config/env').AUTH_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });

  res.json({
    message:
      'Đã ghi nhận và vô hiệu hóa tài khoản. Dữ liệu tài chính/booking được giữ theo quy định kế toán.',
  });
});

module.exports = {
  listFavorites,
  addFavorite,
  removeFavorite,
  mergeFavorites,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notificationUnreadCount,
  deleteNotification,
  previewCoupon,
  listMessages,
  sendMessage,
  downloadIcs,
  exportMyData,
  requestDeleteAccount,
};
