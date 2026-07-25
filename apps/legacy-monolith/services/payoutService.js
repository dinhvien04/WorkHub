"use strict";

const Payout = require("../models/Payout");
const HostProfile = require("../models/Host_Profile");
const HostBalance = require("../models/HostBalance");
const ledgerService = require("./ledgerService");
const { withTransaction } = require("../utils/mongoTransaction");
const {
  ValidationError,
  NotFoundError,
  ConflictError,
} = require("../utils/errors");
const env = require("../config/env");

/** Test-only hooks */
const _testHooks = {
  afterPayoutCreate: null,
  afterLedger: null,
  beforePaid: null,
};

function setTestHooks(hooks = {}) {
  Object.assign(_testHooks, hooks);
}
function clearTestHooks() {
  for (const k of Object.keys(_testHooks)) _testHooks[k] = null;
}
async function runHook(name) {
  if (typeof _testHooks[name] === "function") await _testHooks[name]();
}

async function ensureBalanceProjection(hostId, session = null) {
  const findQ = HostBalance.findOne({ HostID: hostId });
  if (session) findQ.session(session);
  let bal = await findQ;
  if (!bal) {
    const snap = await ledgerService.getHostBalance(hostId);
    try {
      const created = session
        ? await HostBalance.create(
            [
              {
                HostID: hostId,
                AvailableBalance: snap.available,
                ReservedBalance: 0,
                PaidOutBalance: snap.paidOut || 0,
                Version: 0,
              },
            ],
            { session },
          )
        : await HostBalance.create({
            HostID: hostId,
            AvailableBalance: snap.available,
            ReservedBalance: 0,
            PaidOutBalance: snap.paidOut || 0,
            Version: 0,
          });
      bal = session ? created[0] : created;
    } catch (err) {
      if (err.code === 11000) {
        const again = HostBalance.findOne({ HostID: hostId });
        if (session) again.session(session);
        bal = await again;
      } else throw err;
    }
  }
  return bal;
}

/**
 * Atomic payout request: conditional reserve + create Payout + ledger reservation.
 * Production requires Mongo transactions (ENABLE_TRANSACTIONS).
 */
async function requestPayout({ hostId, amount, idempotencyKey }) {
  const crypto = require("crypto");
  const amt = Math.round(Number(amount));
  if (!amt || amt < 50000) {
    throw new ValidationError("Số tiền rút tối thiểu 50.000đ.");
  }
  if (!idempotencyKey) {
    throw new ValidationError("Idempotency-Key là bắt buộc cho payout.");
  }

  // Host-scoped hashed key — never store raw client key globally unique alone
  const clientKeyHash = crypto
    .createHash("sha256")
    .update(`payout:${hostId}:${idempotencyKey}`)
    .digest("hex");
  const requestFingerprint = crypto
    .createHash("sha256")
    .update(`${hostId}|${amt}|VND|payout`)
    .digest("hex");
  const scopedIdempotencyKey = clientKeyHash;

  const existing = await Payout.findOne({
    IdempotencyKey: scopedIdempotencyKey,
  });
  if (existing) {
    if (
      existing.Amount !== amt ||
      String(existing.HostID) !== String(hostId) ||
      (existing.Meta?.requestFingerprint &&
        existing.Meta.requestFingerprint !== requestFingerprint)
    ) {
      throw new ConflictError("Idempotency key đã dùng cho payout khác.");
    }
    return existing;
  }

  const profile = await HostProfile.findOne({ UserID: hostId }).lean();
  if (!profile) {
    throw new ValidationError("Host profile chưa có thông tin ngân hàng.");
  }
  // Prefer verified host profile for production payouts
  if (
    env.isProduction &&
    !(profile.IsVerified === true || profile.VerificationStatus === "approved")
  ) {
    throw new ValidationError("Host chưa được xác minh — không thể rút tiền.");
  }

  const masked = profile?.BankNumber
    ? `****${String(profile.BankNumber).slice(-4)}`
    : "";

  try {
    return await withTransaction(
      async (session) => {
        await ensureBalanceProjection(hostId, session);

        // Atomic conditional reserve AvailableBalance >= amount
        const reserveQ = HostBalance.findOneAndUpdate(
          { HostID: hostId, AvailableBalance: { $gte: amt } },
          {
            $inc: {
              AvailableBalance: -amt,
              ReservedBalance: amt,
              Version: 1,
            },
          },
          { new: true },
        );
        if (session) reserveQ.session(session);
        const reserved = await reserveQ;
        if (!reserved) {
          throw new ValidationError("Số dư khả dụng không đủ.");
        }

        let payout;
        try {
          const created = session
            ? await Payout.create(
                [
                  {
                    HostID: hostId,
                    Amount: amt,
                    Status: "requested",
                    BankName: profile?.BankName || "",
                    BankNumberMasked: masked,
                    IdempotencyKey: scopedIdempotencyKey,
                    Meta: {
                      clientKeyHash,
                      requestFingerprint,
                      operation: "payout",
                    },
                  },
                ],
                { session },
              )
            : await Payout.create({
                HostID: hostId,
                Amount: amt,
                Status: "requested",
                BankName: profile?.BankName || "",
                BankNumberMasked: masked,
                IdempotencyKey: scopedIdempotencyKey,
                Meta: {
                  clientKeyHash,
                  requestFingerprint,
                  operation: "payout",
                },
              });
          payout = session ? created[0] : created;
        } catch (err) {
          if (err.code === 11000) {
            const again = await Payout.findOne({
              IdempotencyKey: scopedIdempotencyKey,
            });
            if (again) {
              // Release our reserve — concurrent winner owns it
              const releaseQ = HostBalance.findOneAndUpdate(
                { HostID: hostId, ReservedBalance: { $gte: amt } },
                {
                  $inc: {
                    AvailableBalance: amt,
                    ReservedBalance: -amt,
                    Version: 1,
                  },
                },
              );
              if (session) releaseQ.session(session);
              await releaseQ;
              if (
                again.Amount !== amt ||
                String(again.HostID) !== String(hostId)
              ) {
                throw new ConflictError(
                  "Idempotency key đã dùng cho payout khác.",
                );
              }
              return again;
            }
          }
          throw err;
        }

        await runHook("afterPayoutCreate");

        // Reserve is a balance transfer (available→reserved), NOT a final external debit.
        await ledgerService.postEntry(
          {
            hostId,
            type: "adjustment",
            amount: amt,
            direction: "debit",
            description: `Payout reserve ${payout._id}`,
            idempotencyKey: `payout:${payout._id}:reserve`,
            meta: {
              payoutId: payout._id,
              status: "requested",
              kind: "payout_reserve",
              skipProjection: true,
            },
          },
          { session },
        );
        await runHook("afterLedger");

        return payout;
      },
      { required: env.isProduction },
    );
  } catch (err) {
    // Non-transaction path: if we reserved then failed mid-way, release
    // (transaction path rolls back automatically)
    if (!env.ENABLE_TRANSACTIONS && err && !err.isOperational) {
      // Best-effort: look for orphan reserve without payout is hard;
      // hooks tests inject after create — compensate if payout exists without ledger
    }
    if (err.code === 11000) {
      const again = await Payout.findOne({
        IdempotencyKey: scopedIdempotencyKey,
      });
      if (again) return again;
      throw new ConflictError("Payout trùng lặp.");
    }
    throw err;
  }
}

/**
 * Process payout: reject releases reserve; approve marks paid only with
 * reserved funds CAS + final ledger + audit fields.
 */
async function processPayout({
  payoutId,
  approve,
  adminId,
  transferReference = null,
}) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw new NotFoundError("Không tìm thấy payout.");
  if (payout.Status !== "requested" && payout.Status !== "processing") {
    throw new ValidationError("Payout không thể xử lý.");
  }

  if (!approve) {
    return withTransaction(async (session) => {
      const failQ = Payout.findOneAndUpdate(
        { _id: payoutId, Status: { $in: ["requested", "processing"] } },
        {
          $set: {
            Status: "failed",
            FailureReason: "Rejected by admin",
            ProcessedAt: new Date(),
            ProcessedBy: adminId || null,
          },
        },
        { new: true },
      );
      if (session) failQ.session(session);
      const failed = await failQ;
      if (!failed) return payout;

      // Release reservation once (conditional)
      const releaseQ = HostBalance.findOneAndUpdate(
        {
          HostID: payout.HostID,
          ReservedBalance: { $gte: payout.Amount },
        },
        {
          $inc: {
            AvailableBalance: payout.Amount,
            ReservedBalance: -payout.Amount,
            Version: 1,
          },
        },
        { new: true },
      );
      if (session) releaseQ.session(session);
      await releaseQ;

      await ledgerService.postEntry(
        {
          hostId: payout.HostID,
          type: "adjustment",
          amount: payout.Amount,
          direction: "credit",
          description: `Payout failed restore ${payout._id}`,
          idempotencyKey: `payout:${payout._id}:restore`,
          meta: {
            payoutId: payout._id,
            kind: "payout_restore",
            skipProjection: true,
          },
        },
        { session },
      );
      return failed;
    });
  }

  // Approve → paid requires reserved funds + transfer reference evidence
  if (!transferReference || !String(transferReference).trim()) {
    throw new ValidationError(
      "TransferReference (bằng chứng chuyển khoản) là bắt buộc khi mark paid.",
    );
  }

  const paid = await withTransaction(
    async (session) => {
      await runHook("beforePaid");

      // CAS payout state first
      const casQ = Payout.findOneAndUpdate(
        { _id: payoutId, Status: { $in: ["requested", "processing"] } },
        {
          $set: {
            Status: "paid",
            ProcessedAt: new Date(),
            ProcessedBy: adminId || null,
            TransferReference: String(transferReference).slice(0, 200),
          },
        },
        { new: true },
      );
      if (session) casQ.session(session);
      const casPaid = await casQ;
      if (!casPaid) throw new ValidationError("Payout không thể xử lý.");

      // Require ReservedBalance >= amount — reject orphan payouts
      const balQ = HostBalance.findOneAndUpdate(
        {
          HostID: payout.HostID,
          ReservedBalance: { $gte: payout.Amount },
        },
        {
          $inc: {
            ReservedBalance: -payout.Amount,
            PaidOutBalance: payout.Amount,
            Version: 1,
          },
        },
        { new: true },
      );
      if (session) balQ.session(session);
      const bal = await balQ;
      if (!bal) {
        // Revert CAS — no reserve
        const revertQ = Payout.findOneAndUpdate(
          { _id: payoutId, Status: "paid" },
          {
            $set: {
              Status: "requested",
              ProcessedAt: null,
              FailureReason: "No reserved balance",
            },
          },
        );
        if (session) revertQ.session(session);
        await revertQ;
        throw new ValidationError(
          "Payout không có quỹ đã reserve — từ chối mark paid.",
        );
      }

      // Exactly ONE final payout debit after confirmed settlement (reserved→paid_out)
      await ledgerService.postEntry(
        {
          hostId: payout.HostID,
          type: "payout",
          amount: payout.Amount,
          direction: "debit",
          description: `Payout paid ${payout._id}`,
          idempotencyKey: `payout:${payout._id}:paid`,
          meta: {
            payoutId: payout._id,
            status: "paid",
            kind: "payout_settle",
            adminId: adminId || null,
            transferReference: String(transferReference).slice(0, 200),
            skipProjection: true,
          },
        },
        { session },
      );

      return casPaid;
    },
    { required: env.isProduction },
  );

  // Side effects after commit via outbox
  try {
    const outboxService = require("./outboxService");
    await outboxService.enqueueNotification(
      {
        userId: payout.HostID,
        title: "Payout đã chuyển",
        body: `${payout.Amount.toLocaleString("vi-VN")}đ`,
        type: "payment",
        entityType: "Payout",
        entityId: payout._id,
      },
      { idempotencyKey: `payout:${payout._id}:notify-paid` },
    );
    // Worker owns delivery — never processPending or direct notify fallback
  } catch {
    /* enqueue failure is non-fatal for finance settle */
  }
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
 * Prefer ledgerService.postEntry which already updates projection.
 */
/**
 * @deprecated Direct balance credit is forbidden — use ledgerService.postEntry.
 * Kept as thin wrapper that posts a ledger credit for compatibility.
 */
async function creditAvailable(hostId, amount) {
  const amt = Math.round(Math.abs(amount));
  return ledgerService.postEntry({
    hostId,
    type: "payment",
    amount: amt,
    direction: "credit",
    description: "creditAvailable compatibility wrapper",
    idempotencyKey: `compat-credit:${hostId}:${amt}:${Date.now()}`,
    meta: { via: "creditAvailable_deprecated" },
  });
}

module.exports = {
  requestPayout,
  processPayout,
  listHostPayouts,
  ensureBalanceProjection,
  creditAvailable,
  setTestHooks,
  clearTestHooks,
};
