'use strict';

const Conversation = require('../models/Conversation');
const Booking = require('../models/Booking');
const { ForbiddenError, NotFoundError, ValidationError } = require('../utils/errors');
const { notifyUser } = require('./notificationService');

async function getOrCreateConversation(bookingId, userId, role) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError('Không tìm thấy booking.');

  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== 'admin') {
    throw new ForbiddenError('Không có quyền xem hội thoại này.');
  }

  let conv = await Conversation.findOne({ BookingID: bookingId });
  if (!conv) {
    conv = await Conversation.create({
      BookingID: bookingId,
      CustomerID: booking.CustomerID,
      HostID: booking.HostID,
      Messages: [],
    });
  }
  return conv;
}

async function listMessages(bookingId, userId, role) {
  const conv = await getOrCreateConversation(bookingId, userId, role);
  return {
    conversationId: conv._id,
    messages: (conv.Messages || []).slice(-100).map((m) => ({
      _id: m._id,
      senderId: m.SenderID,
      body: m.Body,
      isSystem: m.IsSystem,
      createdAt: m.createdAt,
    })),
  };
}

async function sendMessage(bookingId, userId, role, body) {
  const text = String(body || '').trim();
  if (!text || text.length > 4000) throw new ValidationError('Nội dung không hợp lệ.');

  const conv = await getOrCreateConversation(bookingId, userId, role);
  conv.Messages.push({
    SenderID: userId,
    Body: text,
    IsSystem: false,
    ReadBy: [userId],
  });
  conv.LastMessageAt = new Date();
  await conv.save();

  const recipient =
    String(conv.CustomerID) === String(userId) ? conv.HostID : conv.CustomerID;
  await notifyUser({
    userId: recipient,
    title: 'Tin nhắn booking mới',
    body: text.slice(0, 120),
    type: 'message',
    entityType: 'Booking',
    entityId: bookingId,
    link: `/history`,
  });

  const last = conv.Messages[conv.Messages.length - 1];
  return {
    _id: last._id,
    senderId: last.SenderID,
    body: last.Body,
    createdAt: last.createdAt,
  };
}

module.exports = { listMessages, sendMessage, getOrCreateConversation };
