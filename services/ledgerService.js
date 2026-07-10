"use strict";

const LedgerEntry = require("../models/LedgerEntry");
const HostBalance = require("../models/HostBalance");
const { ValidationError } = require("../utils/errors");
const { withTransaction } = require("../utils/mongoTransaction");

/**
 * Post an immutable ledger entry and update HostBalance projection atomically.
 * Projection failure is fatal — both steps share the same transaction/session.
 *
 * @param {object} data
 * @param {{ session?: import('mongoose').ClientSession | null }} [opts]
 */
async function postEntry(
  {
    hostId,
    customerId = null,
    bookingId = null,
    paymentId = null,
    type,
    amount,
    direction,
    description = "",
    idempotencyKey = null,
    meta = {},
  },
  opts = {},
) {
  if (!hostId || !type || amount == null || !direction) {
    throw new ValidationError("Ledger entry thiếu field bắt buộc.");
  }
  const amt = Math.round(Math.abs(Number(amount)));
  if (!amt || amt <= 0) {
    throw new ValidationError("Ledger amount không hợp lệ.");
  }

  const externalSession = opts.session !== undefined ? opts.session : undefined;

  async function run(session) {
    if (idempotencyKey) {
      const existingQ = LedgerEntry.findOne({ IdempotencyKey: idempotencyKey });
      if (session) existingQ.session(session);
      const existing = await existingQ;
      if (existing) return existing;
    }

    const createOpts = session ? { session } : {};
    let entry;
    try {
      const created = await LedgerEntry.create(
        [
          {
            HostID: hostId,
            CustomerID: customerId,
            BookingID: bookingId,
            PaymentID: paymentId,
            Type: type,
            Amount: amt,
            Direction: direction,
            Status: "posted",
            IdempotencyKey: idempotencyKey || undefined,
            Meta: meta,
            Description: description,
          },
        ],
        createOpts,
      );
      entry = created[0];
    } catch (err) {
      if (err.code === 11000 && idempotencyKey) {
        const againQ = LedgerEntry.findOne({ IdempotencyKey: idempotencyKey });
        if (session) againQ.session(session);
        return againQ;
      }
      throw err;
    }

    // Keep HostBalance projection in sync — failure is fatal
    await applyBalanceProjection(entry, session);
    return entry;
  }

  // If caller already has a session, use it (nested in larger finance txn)
  if (externalSession !== undefined) {
    return run(externalSession);
  }

  // Own transaction so entry + projection never diverge
  return withTransaction((session) => run(session));
}

/**
 * Update HostBalance from a posted ledger entry.
 * payment credit → +Available
 * refund debit → -Available (conditional)
 * payout reserve is handled by payoutService (available→reserved)
 * payout restore adjustment credit → handled by payoutService
 */
async function applyBalanceProjection(entry, session) {
  const hostId = entry.HostID;
  const amt = entry.Amount;
  const type = entry.Type;
  const direction = entry.Direction;

  // Payout reserve/final are managed by payoutService conditional updates
  if (type === "payout" && direction === "debit") {
    return;
  }
  if (
    type === "adjustment" &&
    entry.Meta &&
    (entry.Meta.payoutId || entry.Meta.skipProjection)
  ) {
    return;
  }

  let update = null;
  let filter = { HostID: hostId };

  if (type === "payment" && direction === "credit") {
    update = {
      $inc: { AvailableBalance: amt, Version: 1 },
      $setOnInsert: {
        ReservedBalance: 0,
        PaidOutBalance: 0,
        Currency: "VND",
      },
    };
  } else if (type === "refund" && direction === "debit") {
    filter = { HostID: hostId, AvailableBalance: { $gte: amt } };
    update = {
      $inc: { AvailableBalance: -amt, Version: 1 },
      $setOnInsert: {
        ReservedBalance: 0,
        PaidOutBalance: 0,
        Currency: "VND",
      },
    };
  } else if (type === "fee" && direction === "debit") {
    filter = { HostID: hostId, AvailableBalance: { $gte: amt } };
    update = { $inc: { AvailableBalance: -amt, Version: 1 } };
  } else if (type === "adjustment") {
    const signed = direction === "credit" ? amt : -amt;
    if (signed < 0) {
      filter = { HostID: hostId, AvailableBalance: { $gte: -signed } };
    }
    update = {
      $inc: { AvailableBalance: signed, Version: 1 },
      $setOnInsert: {
        ReservedBalance: 0,
        PaidOutBalance: 0,
        Currency: "VND",
      },
    };
  }

  if (!update) return;

  const q = HostBalance.findOneAndUpdate(filter, update, {
    upsert: type === "payment" && direction === "credit",
    new: true,
  });
  if (session) q.session(session);
  const bal = await q;

  if (!bal && type === "refund" && direction === "debit") {
    // Ensure projection row exists, then decrement with floor at 0
    const ensure = HostBalance.findOneAndUpdate(
      { HostID: hostId },
      {
        $setOnInsert: {
          AvailableBalance: 0,
          ReservedBalance: 0,
          PaidOutBalance: 0,
          Currency: "VND",
          Version: 0,
        },
      },
      { upsert: true, new: true },
    );
    if (session) ensure.session(session);
    const row = await ensure;

    const retry = HostBalance.findOneAndUpdate(
      { HostID: hostId, AvailableBalance: { $gte: amt } },
      { $inc: { AvailableBalance: -amt, Version: 1 } },
      { new: true },
    );
    if (session) retry.session(session);
    const again = await retry;
    if (!again) {
      // Floor at 0 when projection lower than refund (ledger still records full amount)
      const floor = HostBalance.findOneAndUpdate(
        { HostID: hostId },
        {
          $set: { AvailableBalance: 0 },
          $inc: { Version: 1 },
        },
        { new: true },
      );
      if (session) floor.session(session);
      await floor;
      if (!row) {
        /* ensured above */
      }
    }
  } else if (!bal && !(type === "payment" && direction === "credit")) {
    // Projection update failed unexpectedly — fatal
    const err = new Error(
      "HostBalance projection update failed after ledger post.",
    );
    err.statusCode = 500;
    err.isOperational = true;
    err.code = "BALANCE_PROJECTION_FAILED";
    throw err;
  }
}

async function getHostBalance(hostId) {
  try {
    const proj = await HostBalance.findOne({ HostID: hostId }).lean();
    if (proj) {
      return {
        available: Math.max(0, proj.AvailableBalance || 0),
        pending: Math.max(0, proj.ReservedBalance || 0),
        paidOut: Math.max(0, proj.PaidOutBalance || 0),
        currency: proj.Currency || "VND",
        projected: true,
      };
    }
  } catch {
    /* fall through */
  }

  const entries = await LedgerEntry.find({
    HostID: hostId,
    Status: "posted",
  }).lean();
  let available = 0;
  let pending = 0;
  let paidOut = 0;
  for (const e of entries) {
    const signed = e.Direction === "credit" ? e.Amount : -e.Amount;
    available += signed;
    if (e.Type === "payout" && e.Direction === "debit") {
      paidOut += e.Amount;
    }
  }
  return {
    available: Math.max(0, available),
    pending,
    paidOut,
    currency: "VND",
    projected: false,
  };
}

async function listLedger(hostId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    LedgerEntry.find({ HostID: hostId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LedgerEntry.countDocuments({ HostID: hostId }),
  ]);
  return { items, total, page, limit };
}

module.exports = {
  postEntry,
  getHostBalance,
  listLedger,
  applyBalanceProjection,
};
