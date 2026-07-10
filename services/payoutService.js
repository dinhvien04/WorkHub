"use strict";

const Payout = require("../models/Payout");
const HostProfile = require("../models/Host_Profile");
const HostBalance = require("../models/HostBalance");
const ledgerService = require("./ledgerService");
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require("../utils/errors");
const { notifyUser } = require("./notificationService");

async function ensureBalanceProjection(hostId) {
  let bal = await HostBalance.findOne({ HostID: hostId });
  if (!bal) {
    // Seed from ledger sum once
    const snap = await ledgerService.getHostBalance(hostId);
    try {
      bal = await HostBalance.create({
        HostID: hostId,
        AvailableBalance: snap.available,
        ReservedBalance: 0,
        PaidOutBalance: snap.paidOut || 0,
        Version: 0,
      });
    } catch (err) {
      if (err.code === 11000) {
        bal = await HostBalance.findOne({ HostID: hostId });
      } else throw err;
    }
  }
  return bal;
}

/**
 * Atomic payout request with mandatory idempotency key and conditional reserve.
 */
async function requestPayout({ hostId, amount, idempotencyKey }) {
  const amt = Math.round(Number(amount));
  if (!amt || amt < 50000) {
    throw new ValidationError("Số tiền rút tối thiểu 50.000đ.");
  }
  if (!idempotencyKey) {
    throw new ValidationError("Idempotency-Key là bắt buộc cho payout.");
  }

  const existing = await Payout.findOne({ IdempotencyKey: idempotencyKey });
  if (existing) {
    if (existing.Amount !== amt || String(existing.HostID) !== String(hostId)) {
      throw new ConflictError("Idempotency key đã dùng cho payout khác.");
    }
    return existing;
  }

  await ensureBalanceProjection(hostId);

  // Atomic conditional reserve
  const reserved = await HostBalance.findOneAndUpdate(
    { HostID: hostId, AvailableBalance: { $gte: amt } },
    {
      $inc: { AvailableBalance: -amt, ReservedBalance: amt, Version: 1 },
    },
    { new: true },
  );
  if (!reserved) {
    throw new ValidationError("Số dư khả dụng không đủ.");
  }

  const profile = await HostProfile.findOne({ UserID: hostId }).lean();
  const masked = profile?.BankNumber
    ? `****${String(profile.BankNumber).slice(-4)}`
    : "";

  try {
    const payout = await Payout.create({
      HostID: hostId,
      Amount: amt,
      Status: "requested",
      BankName: profile?.BankName || "",
      BankNumberMasked: masked,
      IdempotencyKey: idempotencyKey,
    });

    await ledgerService.postEntry({
      hostId,
      type: "payout",
      amount: amt,
      direction: "debit",
      description: `Payout reserve ${payout._id}`,
      idempotencyKey: `payout-ledger-${payout._id}`,
      meta: { payoutId: payout._id, status: "requested" },
    });

    return payout;
  } catch (err) {
    // Release reserve on failure
    await HostBalance.findOneAndUpdate(
      { HostID: hostId },
      { $inc: { AvailableBalance: amt, ReservedBalance: -amt, Version: 1 } },
    );
    if (err.code === 11000) {
      const again = await Payout.findOne({ IdempotencyKey: idempotencyKey });
      if (again) return again;
      throw new ConflictError("Payout trùng lặp.");
    }
    throw err;
  }
}

async function processPayout({ payoutId, approve, adminId: _adminId }) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw new NotFoundError("Không tìm thấy payout.");
  if (payout.Status !== "requested" && payout.Status !== "processing") {
    throw new ValidationError("Payout không thể xử lý.");
  }

  if (!approve) {
    const failed = await Payout.findOneAndUpdate(
      { _id: payoutId, Status: { $in: ["requested", "processing"] } },
      {
        $set: {
          Status: "failed",
          FailureReason: "Rejected by admin",
          ProcessedAt: new Date(),
        },
      },
      { new: true },
    );
    if (!failed) return payout;

    // Release reservation once
    await HostBalance.findOneAndUpdate(
      { HostID: payout.HostID, ReservedBalance: { $gte: payout.Amount } },
      {
        $inc: {
          AvailableBalance: payout.Amount,
          ReservedBalance: -payout.Amount,
          Version: 1,
        },
      },
    );
    await ledgerService.postEntry({
      hostId: payout.HostID,
      type: "adjustment",
      amount: payout.Amount,
      direction: "credit",
      description: `Payout failed restore ${payout._id}`,
      idempotencyKey: `payout-restore-${payout._id}`,
    });
    return failed;
  }

  const paid = await Payout.findOneAndUpdate(
    { _id: payoutId, Status: { $in: ["requested", "processing"] } },
    { $set: { Status: "paid", ProcessedAt: new Date() } },
    { new: true },
  );
  if (!paid) throw new ValidationError("Payout không thể xử lý.");

  await HostBalance.findOneAndUpdate(
    { HostID: payout.HostID },
    {
      $inc: {
        ReservedBalance: -payout.Amount,
        PaidOutBalance: payout.Amount,
        Version: 1,
      },
    },
  );

  await notifyUser({
    userId: payout.HostID,
    title: "Payout đã chuyển",
    body: `${payout.Amount.toLocaleString("vi-VN")}đ`,
    type: "payment",
    entityType: "Payout",
    entityId: payout._id,
  });
  return paid;
}

async function listHostPayouts(hostId) {
  return Payout.find({ HostID: hostId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

/**
 * Credit host balance projection when ledger payment credit posts.
 * Call from payment verify / gateway success paths.
 */
async function creditAvailable(hostId, amount) {
  const amt = Math.round(Math.abs(amount));
  await ensureBalanceProjection(hostId);
  await HostBalance.findOneAndUpdate(
    { HostID: hostId },
    { $inc: { AvailableBalance: amt, Version: 1 } },
    { upsert: true },
  );
}

module.exports = {
  requestPayout,
  processPayout,
  listHostPayouts,
  ensureBalanceProjection,
  creditAvailable,
};
