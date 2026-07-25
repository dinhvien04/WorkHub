"use strict";

const Booking = require("../models/Booking");
const PaymentHistory = require("../models/Payment_History");
const Favorite = require("../models/Favorite");
const Notification = require("../models/Notification");

/**
 * Customer home dashboard: upcoming, action required, payment pending.
 */
async function getCustomerDashboard(userId) {
  const now = new Date();
  const [
    upcoming,
    actionRequired,
    paymentPending,
    favoritesCount,
    unreadNotifications,
  ] = await Promise.all([
    Booking.find({
      CustomerID: userId,
      Status: {
        $in: [
          "confirmed",
          "pending",
          "awaiting_payment",
          "payment_under_review",
          "in-use",
        ],
      },
      EndTime: { $gte: now },
    })
      .sort({ StartTime: 1 })
      .limit(10)
      .select(
        "Status StartTime EndTime TotalAmount DepositAmount Snapshot HoldExpiresAt InstantBook CheckInAt",
      )
      .lean(),
    Booking.find({
      CustomerID: userId,
      $or: [
        {
          Status: { $in: ["awaiting_payment", "payment_under_review", "hold"] },
        },
        {
          Status: "pending",
          HoldExpiresAt: {
            $ne: null,
            $lt: new Date(Date.now() + 30 * 60 * 1000),
          },
        },
      ],
    })
      .sort({ HoldExpiresAt: 1 })
      .limit(10)
      .select(
        "Status StartTime EndTime TotalAmount DepositAmount Snapshot HoldExpiresAt",
      )
      .lean(),
    PaymentHistory.find({
      CustomerID: userId,
      Status: "pending",
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("Amount Status BookingID createdAt PaymentType")
      .lean(),
    Favorite.countDocuments({ UserID: userId }),
    Notification.countDocuments({ UserID: userId, IsRead: false }),
  ]);

  // Check-in ready: confirmed today / starting soon / in-use without check-in
  const soon = new Date(now.getTime() + 4 * 3600000);
  const checkInReady = upcoming
    .filter((b) => {
      if (b.CheckInAt) return false;
      if (!["confirmed", "in-use"].includes(b.Status)) return false;
      const start = new Date(b.StartTime);
      return start <= soon || b.Status === "in-use";
    })
    .slice(0, 5)
    .map((b) => ({
      ...b,
      bookingCode: `WH-${String(b._id).slice(-6).toUpperCase()}`,
      canMintQr: true,
    }));

  return {
    upcoming,
    actionRequired,
    paymentPending,
    checkInReady,
    counts: {
      upcoming: upcoming.length,
      actionRequired: actionRequired.length,
      paymentPending: paymentPending.length,
      favorites: favoritesCount,
      unreadNotifications,
      checkInReady: checkInReady.length,
    },
  };
}

module.exports = { getCustomerDashboard };
