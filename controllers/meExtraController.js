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

module.exports = {
  listFavorites,
  addFavorite,
  removeFavorite,
  mergeFavorites,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  previewCoupon,
  listMessages,
  sendMessage,
  downloadIcs,
};
