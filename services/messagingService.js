"use strict";

const Conversation = require("../models/Conversation");
const Booking = require("../models/Booking");
const {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require("../utils/errors");
const { notifyUser } = require("./notificationService");

async function getOrCreateConversation(bookingId, userId, role) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");

  const isCustomer = String(booking.CustomerID) === String(userId);
  const isHost = String(booking.HostID) === String(userId);
  if (!isCustomer && !isHost && role !== "admin") {
    throw new ForbiddenError("Không có quyền xem hội thoại này.");
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

/** Strip accidental PII patterns from message payloads shown in UI */
function redactContactPii(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email ẩn]")
    .replace(/(?:\+?84|0)\d{8,10}\b/g, "[sđt ẩn]");
}

async function listMessages(bookingId, userId, role) {
  const conv = await getOrCreateConversation(bookingId, userId, role);
  return {
    conversationId: conv._id,
    // Never expose participant emails/phones in conversation payload
    messages: (conv.Messages || []).slice(-100).map((m) => ({
      _id: m._id,
      senderId: m.SenderID,
      body: redactContactPii(m.Body),
      isSystem: m.IsSystem,
      createdAt: m.createdAt,
    })),
  };
}

async function sendMessage(bookingId, userId, role, body) {
  const text = String(body || "").trim();
  if (!text || text.length > 4000)
    throw new ValidationError("Nội dung không hợp lệ.");

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
    title: "Tin nhắn booking mới",
    body: redactContactPii(text).slice(0, 120),
    type: "message",
    entityType: "Booking",
    entityId: bookingId,
    link: `/history`,
  });

  const last = conv.Messages[conv.Messages.length - 1];
  return {
    _id: last._id,
    senderId: last.SenderID,
    body: redactContactPii(last.Body),
    createdAt: last.createdAt,
  };
}

async function reportMessage({
  bookingId,
  userId,
  role,
  messageId,
  reason = "",
}) {
  const conv = await getOrCreateConversation(bookingId, userId, role);
  const msg = (conv.Messages || []).id
    ? conv.Messages.id(messageId)
    : (conv.Messages || []).find((m) => String(m._id) === String(messageId));
  if (!msg) throw new NotFoundError("Không tìm thấy tin nhắn.");

  conv.Reports = conv.Reports || [];
  conv.Reports.push({
    MessageID: msg._id,
    ReportedBy: userId,
    Reason: String(reason || "abuse").slice(0, 500),
    CreatedAt: new Date(),
  });
  // Cap report list
  if (conv.Reports.length > 50) conv.Reports = conv.Reports.slice(-50);
  await conv.save();

  try {
    const logActivity = require("../utils/auditLogger");
    await logActivity(
      userId,
      "REPORT_MESSAGE",
      "Conversation",
      conv._id,
      `Report message ${msg._id}: ${String(reason || "abuse").slice(0, 200)}`,
      "warning",
    );
  } catch {
    /* ignore */
  }

  return { reported: true, conversationId: conv._id, messageId: msg._id };
}

module.exports = {
  listMessages,
  sendMessage,
  getOrCreateConversation,
  reportMessage,
  redactContactPii,
};
