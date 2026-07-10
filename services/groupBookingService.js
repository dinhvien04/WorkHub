"use strict";

const crypto = require("crypto");
const GroupInvite = require("../models/GroupInvite");
const Booking = require("../models/Booking");
const bookingService = require("./bookingService");
const calendarService = require("./calendarService");
const { notifyUser } = require("./notificationService");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");

function normalizeAttendees(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const a of raw.slice(0, 50)) {
    const email = String(a.email || a.Email || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: String(a.name || a.Name || email.split("@")[0]).slice(0, 120),
    });
  }
  return out;
}

async function createGroupBooking({
  customerId,
  spaceId,
  startTime,
  endTime,
  note = "",
  corporateName = "",
  attendees = [],
  addOns = [],
  couponCode = null,
}) {
  const list = normalizeAttendees(attendees);
  const booking = await bookingService.createBooking({
    customerId,
    spaceId,
    startTime,
    endTime,
    note: [
      note || "",
      corporateName ? `Corporate: ${corporateName}` : "",
      list.length ? `Group attendees: ${list.length}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    addOns,
    couponCode,
    preferInstant: true,
  });

  // Mark group on note snapshot-friendly fields via Note already; store invites
  const invites = [];
  for (const a of list) {
    const token = crypto.randomBytes(24).toString("base64url");
    try {
      const inv = await GroupInvite.create({
        BookingID: booking._id,
        OrganizerID: customerId,
        Email: a.email,
        Name: a.name,
        Token: token,
        RsvpStatus: "pending",
      });
      invites.push({
        id: inv._id,
        email: inv.Email,
        name: inv.Name,
        rsvpStatus: inv.RsvpStatus,
        token: inv.Token,
        invitePath: `/rsvp/${inv.Token}`,
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }

  return {
    booking,
    group: {
      corporateName: String(corporateName || "").slice(0, 200),
      attendeeCount: invites.length,
      attendees: invites.map((i) => ({
        email: i.email,
        name: i.name,
        rsvpStatus: i.rsvpStatus,
        invitePath: i.invitePath,
      })),
    },
    // tokens only returned once to organizer
    invites,
    calendarLinks: calendarService.calendarDeepLinks(booking),
  };
}

async function listInvitesForBooking({ bookingId, userId }) {
  const booking = await Booking.findById(bookingId)
    .select("CustomerID HostID")
    .lean();
  if (!booking) throw new NotFoundError("Không tìm thấy booking.");
  if (
    String(booking.CustomerID) !== String(userId) &&
    String(booking.HostID) !== String(userId)
  ) {
    throw new ForbiddenError("Không có quyền xem invite.");
  }
  const items = await GroupInvite.find({ BookingID: bookingId })
    .select("-Token")
    .sort({ createdAt: 1 })
    .lean();
  return items.map((i) => ({
    id: i._id,
    email: i.Email,
    name: i.Name,
    rsvpStatus: i.RsvpStatus,
    rsvpAt: i.RsvpAt,
  }));
}

async function getInviteByToken(token) {
  const inv = await GroupInvite.findOne({ Token: String(token) }).lean();
  if (!inv) throw new NotFoundError("Lời mời không hợp lệ.");
  const booking = await Booking.findById(inv.BookingID).lean();
  if (!booking) throw new NotFoundError("Booking không còn tồn tại.");
  return {
    invite: {
      email: inv.Email,
      name: inv.Name,
      rsvpStatus: inv.RsvpStatus,
      rsvpAt: inv.RsvpAt,
    },
    booking: {
      id: booking._id,
      startTime: booking.StartTime,
      endTime: booking.EndTime,
      status: booking.Status,
      snapshot: booking.Snapshot,
      spaceName: booking.Snapshot?.SpaceName,
      address: booking.Snapshot?.Address,
    },
    calendarLinks: calendarService.calendarDeepLinks(booking),
  };
}

async function rsvpByToken({ token, status, note = "" }) {
  if (!["accepted", "declined"].includes(status)) {
    throw new ValidationError("RSVP phải là accepted hoặc declined.");
  }
  const inv = await GroupInvite.findOne({ Token: String(token) });
  if (!inv) throw new NotFoundError("Lời mời không hợp lệ.");
  inv.RsvpStatus = status;
  inv.RsvpAt = new Date();
  if (note) inv.Note = String(note).slice(0, 500);
  await inv.save();

  // Notify organizer (best effort)
  try {
    await notifyUser({
      userId: inv.OrganizerID,
      title: `RSVP ${status}`,
      body: `${inv.Name || inv.Email} → ${status}`,
      type: "booking",
      entityType: "Booking",
      entityId: inv.BookingID,
    });
  } catch {
    /* ignore */
  }

  return {
    email: inv.Email,
    name: inv.Name,
    rsvpStatus: inv.RsvpStatus,
    rsvpAt: inv.RsvpAt,
  };
}

module.exports = {
  createGroupBooking,
  listInvitesForBooking,
  getInviteByToken,
  rsvpByToken,
  normalizeAttendees,
};
