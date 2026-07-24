"use strict";

const crypto = require("crypto");
const Booking = require("../models/Booking");
const env = require("../config/env");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");
const bookingService = require("./bookingService");

const EARLY_MINUTES = Number(process.env.CHECKIN_EARLY_MINUTES) || 30;
const LATE_MINUTES = Number(process.env.CHECKIN_LATE_MINUTES) || 60;
const NOSHOW_GRACE_MINUTES = Number(process.env.NOSHOW_GRACE_MINUTES) || 15;

function checkInSecret() {
  return env.CHECKIN_TOKEN_SECRET || env.JWT_SECRET;
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", checkInSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !String(token).includes(".")) return null;
  const [body, sig] = String(token).split(".");
  const expected = crypto
    .createHmac("sha256", checkInSecret())
    .update(body)
    .digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashCode(code) {
  // Domain-separated hash so check-in codes are not portable across secrets
  return crypto
    .createHmac("sha256", checkInSecret())
    .update(String(code).toUpperCase())
    .digest("hex");
}

function randomHumanCode() {
  // 16 hex chars (64 bits) + prefix — exceeds 50-bit target
  return `WH-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

function assertCheckInWindow(booking, now = new Date()) {
  const start = new Date(booking.StartTime).getTime();
  const end = new Date(booking.EndTime).getTime();
  const t = now.getTime();
  const early = start - EARLY_MINUTES * 60000;
  const late = end + LATE_MINUTES * 60000;
  if (t < early) {
    throw new ValidationError(
      `Chưa đến giờ check-in (sớm tối đa ${EARLY_MINUTES} phút).`,
    );
  }
  if (t > late) {
    throw new ValidationError("Đã quá cửa sổ check-in.");
  }
}

/**
 * Short-lived QR token + random human code (hashed on booking).
 */
async function mintCheckInToken({
  bookingId,
  actorId,
  actorRole,
  ttlMinutes = 30,
}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  const isCustomer = String(booking.CustomerID) === String(actorId);
  const isHost = String(booking.HostID) === String(actorId);
  if (!isCustomer && !isHost && actorRole !== "admin") {
    throw new ForbiddenError("Không có quyền tạo mã check-in.");
  }
  if (!["confirmed", "in-use"].includes(booking.Status)) {
    throw new ValidationError("Booking chưa sẵn sàng check-in.");
  }

  const code = randomHumanCode();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  booking.CheckInCodeHash = hashCode(code);
  booking.CheckInCodeExpiresAt = expiresAt;
  await booking.save();

  const payload = {
    bid: String(booking._id),
    hid: String(booking.HostID),
    nonce: crypto.randomBytes(8).toString("hex"),
    exp: expiresAt.getTime(),
  };
  return {
    token: signPayload(payload),
    code,
    expiresAt: expiresAt.toISOString(),
    bookingId: booking._id,
  };
}

async function checkInWithToken({ hostId, token, code, hostContext = null }) {
  let booking = null;

  if (token) {
    const payload = verifyToken(token);
    if (!payload?.bid)
      throw new ValidationError("Mã QR không hợp lệ hoặc đã hết hạn.");
    if (payload.hid && String(payload.hid) !== String(hostId)) {
      throw new ForbiddenError("Mã QR không thuộc host này.");
    }
    booking = await Booking.findOne({ _id: payload.bid, HostID: hostId });
  } else if (code) {
    const h = hashCode(code);
    booking = await Booking.findOne({
      HostID: hostId,
      CheckInCodeHash: h,
      CheckInCodeExpiresAt: { $gt: new Date() },
      Status: { $in: ["confirmed", "in-use"] },
    });
    if (!booking) throw new NotFoundError("Không tìm thấy booking với mã này.");
  } else {
    throw new ValidationError("Cần token QR hoặc booking code.");
  }

  if (!booking) throw new NotFoundError("Không tìm thấy booking.");

  // Staff branch scope via Space
  if (hostContext && !hostContext.isOwner && hostContext.allowedBranchIds) {
    const Space = require("../models/Space");
    const space = await Space.findById(booking.SpaceID)
      .select("BranchID")
      .lean();
    if (
      !space?.BranchID ||
      !hostContext.allowedBranchIds.includes(String(space.BranchID))
    ) {
      throw new ForbiddenError("Không có quyền check-in chi nhánh này.");
    }
  }

  if (booking.Status !== "confirmed" && booking.Status !== "in-use") {
    throw new ValidationError("Booking không ở trạng thái check-in.");
  }
  if (booking.CheckInAt) {
    throw new ValidationError("Booking đã check-in.");
  }

  assertCheckInWindow(booking);

  const updated = await bookingService.checkInBooking(hostId, booking._id);
  if (updated) {
    updated.CheckInAt = updated.CheckInAt || new Date();
    // One-time code
    updated.CheckInCodeHash = null;
    updated.CheckInCodeExpiresAt = null;
    await updated.save();
  }
  return updated;
}

async function markNoShow({
  hostId,
  bookingId,
  reason = "",
  hostContext = null,
}) {
  const booking = await Booking.findOne({ _id: bookingId, HostID: hostId });
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");

  if (hostContext && !hostContext.isOwner && hostContext.allowedBranchIds) {
    const Space = require("../models/Space");
    const space = await Space.findById(booking.SpaceID)
      .select("BranchID")
      .lean();
    if (
      !space?.BranchID ||
      !hostContext.allowedBranchIds.includes(String(space.BranchID))
    ) {
      throw new ForbiddenError("Không có quyền no-show chi nhánh này.");
    }
  }

  if (!["confirmed", "pending", "awaiting_payment"].includes(booking.Status)) {
    throw new ValidationError(
      "Chỉ đánh dấu no-show với đơn confirmed/pending.",
    );
  }

  const graceEnd =
    new Date(booking.StartTime).getTime() + NOSHOW_GRACE_MINUTES * 60000;
  if (Date.now() < graceEnd) {
    throw new ValidationError(
      `Chưa hết thời gian chờ no-show (grace ${NOSHOW_GRACE_MINUTES} phút sau giờ bắt đầu).`,
    );
  }

  booking.Status = "no_show";
  booking.CancelReason = `no_show: ${String(reason || "").slice(0, 400)}`;
  booking.CancelledAt = new Date();
  booking.CancelledBy = hostId;
  booking.NoShow = true;
  booking.CheckInCodeHash = null;
  await booking.save();
  const BookingSlot = require("../models/BookingSlot");
  await BookingSlot.deleteMany({ BookingID: booking._id });
  return booking;
}

module.exports = {
  mintCheckInToken,
  checkInWithToken,
  markNoShow,
  signPayload,
  verifyToken,
  hashCode,
  assertCheckInWindow,
  EARLY_MINUTES,
  LATE_MINUTES,
  NOSHOW_GRACE_MINUTES,
};
