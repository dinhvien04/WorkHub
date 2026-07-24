"use strict";

const LedgerEntry = require("../models/LedgerEntry");
const HostBalance = require("../models/HostBalance");
const { ValidationError } = require("../utils/errors");
const { withTransaction } = require("../utils/mongoTransaction");

/**
 * Post an immutable ledger entry and update HostBalance projection atomically.
 *
 * Accounting model:
 * - payment credit → +Available (repays DebtBalance first)
 * - refund debit → -Available (may go negative / raise DebtBalance — no silent clamp)
 * - payout_reserve (adjustment) → Available→Reserved transfer (not external debit)
 * - payout settle (type=payout debit) → Reserved→PaidOut (exactly one final debit)
 * - payout_release (adjustment credit) → Reserved→Available
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

  const crypto = require("crypto");
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      [
        String(hostId),
        String(customerId || ""),
        String(bookingId || ""),
        String(paymentId || ""),
        String(type),
        String(direction),
        String(amt),
        String(meta.currency || "VND"),
      ].join("|"),
    )
    .digest("hex");

  async function run(session) {
    if (idempotencyKey) {
      const existingQ = LedgerEntry.findOne({ IdempotencyKey: idempotencyKey });
      if (session) existingQ.session(session);
      const existing = await existingQ;
      if (existing) {
        const prev = existing.Meta?.requestFingerprint;
        if (prev && prev !== fingerprint) {
          const { ConflictError } = require("../utils/errors");
          throw new ConflictError(
            "Ledger Idempotency-Key đã dùng với fingerprint khác.",
          );
        }
        return existing;
      }
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
            Meta: { ...meta, requestFingerprint: fingerprint },
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
        const again = await againQ;
        if (again) {
          const prev = again.Meta?.requestFingerprint;
          if (prev && prev !== fingerprint) {
            const { ConflictError } = require("../utils/errors");
            throw new ConflictError(
              "Ledger Idempotency-Key đã dùng với fingerprint khác.",
            );
          }
          return again;
        }
      }
      throw err;
    }

    await applyBalanceProjection(entry, session);
    return entry;
  }

  if (externalSession !== undefined) {
    return run(externalSession);
  }

  return withTransaction((session) => run(session), {
    required: opts.required,
  });
}

/**
 * Update HostBalance from a posted ledger entry.
 */
async function applyBalanceProjection(entry, session) {
  const hostId = entry.HostID;
  const amt = entry.Amount;
  const type = entry.Type;
  const direction = entry.Direction;
  const meta = entry.Meta || {};

  // Payout transfers managed by payoutService (available/reserved/paidOut CAS)
  if (type === "payout" && direction === "debit") {
    return;
  }
  if (
    type === "adjustment" &&
    (meta.skipProjection ||
      meta.kind === "payout_reserve" ||
      meta.kind === "payout_release" ||
      meta.kind === "payout_restore" ||
      meta.payoutId)
  ) {
    return;
  }

  let update = null;
  let filter = { HostID: hostId };

  if (type === "payment" && direction === "credit") {
    // Future credits repay debt first
    update = {
      $inc: { AvailableBalance: amt, Version: 1 },
      $setOnInsert: {
        ReservedBalance: 0,
        PaidOutBalance: 0,
        DebtBalance: 0,
        Currency: "VND",
      },
    };
  } else if (type === "refund" && direction === "debit") {
    // No silent floor — allow AvailableBalance to go negative; track debt
    update = {
      $inc: { AvailableBalance: -amt, Version: 1 },
      $setOnInsert: {
        ReservedBalance: 0,
        PaidOutBalance: 0,
        DebtBalance: 0,
        Currency: "VND",
      },
    };
  } else if (type === "fee" && direction === "debit") {
    update = {
      $inc: { AvailableBalance: -amt, Version: 1 },
    };
  } else if (type === "adjustment") {
    const signed = direction === "credit" ? amt : -amt;
    update = {
      $inc: { AvailableBalance: signed, Version: 1 },
      $setOnInsert: {
        ReservedBalance: 0,
        PaidOutBalance: 0,
        DebtBalance: 0,
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
  let bal = await q;

  if (!bal && type === "refund" && direction === "debit") {
    // Ensure row then apply full debit (may go negative — no clamp)
    const ensure = HostBalance.findOneAndUpdate(
      { HostID: hostId },
      {
        $setOnInsert: {
          AvailableBalance: 0,
          ReservedBalance: 0,
          PaidOutBalance: 0,
          DebtBalance: 0,
          Currency: "VND",
          Version: 0,
        },
      },
      { upsert: true, new: true },
    );
    if (session) ensure.session(session);
    await ensure;

    const apply = HostBalance.findOneAndUpdate(
      { HostID: hostId },
      { $inc: { AvailableBalance: -amt, Version: 1 } },
      { new: true },
    );
    if (session) apply.session(session);
    bal = await apply;
  }

  // Normalize debt: if AvailableBalance < 0, lift into DebtBalance representation
  if (bal && (bal.AvailableBalance || 0) < 0) {
    const debt = Math.abs(bal.AvailableBalance);
    const norm = HostBalance.findOneAndUpdate(
      { HostID: hostId, AvailableBalance: { $lt: 0 } },
      {
        $set: { AvailableBalance: 0 },
        $inc: { DebtBalance: debt },
      },
      { new: true },
    );
    if (session) norm.session(session);
    await norm;
  }

  // Payment credits repay debt first
  if (bal && type === "payment" && direction === "credit") {
    const freshQ = HostBalance.findOne({ HostID: hostId });
    if (session) freshQ.session(session);
    const fresh = await freshQ;
    if (fresh && (fresh.DebtBalance || 0) > 0) {
      const repay = Math.min(fresh.DebtBalance, amt);
      const repayQ = HostBalance.findOneAndUpdate(
        { HostID: hostId, DebtBalance: { $gte: repay } },
        {
          $inc: {
            DebtBalance: -repay,
            AvailableBalance: -repay,
            Version: 1,
          },
        },
        { new: true },
      );
      if (session) repayQ.session(session);
      await repayQ;
    }
  } else if (
    !bal &&
    !(type === "payment" && direction === "credit") &&
    !(type === "refund" && direction === "debit")
  ) {
    const err = new Error(
      "HostBalance projection update failed after ledger post.",
    );
    err.statusCode = 500;
    err.isOperational = true;
    err.code = "BALANCE_PROJECTION_FAILED";
    throw err;
  }
}

/**
 * Rebuild balance from ledger using coherent rules (no double-count payout).
 */
function computeFromLedger(entries) {
  let available = 0;
  let reserved = 0;
  let paidOut = 0;
  let debt = 0;

  for (const e of entries) {
    const kind = e.Meta?.kind || e.Meta?.status || "";
    if (e.Type === "payment" && e.Direction === "credit") {
      available += e.Amount;
    } else if (e.Type === "refund" && e.Direction === "debit") {
      available -= e.Amount;
    } else if (e.Type === "fee" && e.Direction === "debit") {
      available -= e.Amount;
    } else if (e.Type === "payout" && e.Direction === "debit") {
      // Final settlement only — reserved → paid_out
      reserved -= e.Amount;
      paidOut += e.Amount;
    } else if (e.Type === "adjustment") {
      if (kind === "payout_reserve" || e.Meta?.status === "requested") {
        available -= e.Amount;
        reserved += e.Amount;
      } else if (
        kind === "payout_release" ||
        kind === "payout_restore" ||
        e.Description?.includes("restore")
      ) {
        available += e.Amount;
        reserved -= e.Amount;
      } else if (e.Meta?.skipProjection) {
        // skip non-balance adjustments (overpay hold etc.)
      } else {
        available += e.Direction === "credit" ? e.Amount : -e.Amount;
      }
    } else if (e.Direction === "credit") {
      available += e.Amount;
    } else {
      available -= e.Amount;
    }
  }

  if (available < 0) {
    debt = Math.abs(available);
    available = 0;
  }
  reserved = Math.max(0, reserved);
  paidOut = Math.max(0, paidOut);

  return { available, reserved, paidOut, debt };
}

async function getHostBalance(hostId) {
  try {
    const proj = await HostBalance.findOne({ HostID: hostId }).lean();
    if (proj) {
      return {
        available: proj.AvailableBalance || 0,
        pending: Math.max(0, proj.ReservedBalance || 0),
        paidOut: Math.max(0, proj.PaidOutBalance || 0),
        debt: Math.max(0, proj.DebtBalance || 0),
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
  const snap = computeFromLedger(entries);
  return {
    available: snap.available,
    pending: snap.reserved,
    paidOut: snap.paidOut,
    debt: snap.debt,
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

/**
 * Detect legacy double-debit payout patterns (reserve + paid both type=payout).
 */
async function detectDoubleDebitPayouts(hostId = null) {
  const filter = {
    Type: "payout",
    Direction: "debit",
    Status: "posted",
  };
  if (hostId) filter.HostID = hostId;
  const entries = await LedgerEntry.find(filter).lean();
  const byPayout = new Map();
  for (const e of entries) {
    const pid = String(e.Meta?.payoutId || e.IdempotencyKey || e._id);
    if (!byPayout.has(pid)) byPayout.set(pid, []);
    byPayout.get(pid).push(e);
  }
  const doubles = [];
  for (const [pid, list] of byPayout) {
    if (list.length >= 2) {
      doubles.push({ payoutKey: pid, count: list.length, entries: list });
    }
  }
  return doubles;
}

module.exports = {
  postEntry,
  getHostBalance,
  listLedger,
  applyBalanceProjection,
  computeFromLedger,
  detectDoubleDebitPayouts,
};
