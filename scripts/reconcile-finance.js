"use strict";

/**
 * Compare PaymentHistory / Refunds / Payouts / Ledger / HostBalance.
 * Usage:
 *   node scripts/reconcile-finance.js --dry-run
 *   node scripts/reconcile-finance.js --apply --confirm=YES
 */
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const dryRun =
    process.argv.includes("--dry-run") || !process.argv.includes("--apply");
  const confirm = process.argv.includes("--confirm=YES");
  if (!dryRun && !confirm) {
    console.error("Refusing --apply without --confirm=YES");
    process.exit(2);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const LedgerEntry = require("../models/LedgerEntry");
  const HostBalance = require("../models/HostBalance");
  const PaymentHistory = require("../models/Payment_History");
  const RefundAllocation = require("../models/RefundAllocation");
  const Refund = require("../models/Refund");
  const Payout = require("../models/Payout");

  const hostIds = await LedgerEntry.distinct("HostID");
  const report = [];
  const anomalies = [];

  for (const hostId of hostIds) {
    const entries = await LedgerEntry.find({
      HostID: hostId,
      Status: "posted",
    }).lean();
    let ledgerAvail = 0;
    const keys = new Set();
    let duplicateLedger = 0;
    for (const e of entries) {
      ledgerAvail += e.Direction === "credit" ? e.Amount : -e.Amount;
      if (e.IdempotencyKey) {
        if (keys.has(e.IdempotencyKey)) duplicateLedger += 1;
        keys.add(e.IdempotencyKey);
      }
    }
    ledgerAvail = Math.max(0, ledgerAvail);
    const proj = await HostBalance.findOne({ HostID: hostId }).lean();
    const projected = proj
      ? proj.AvailableBalance + (proj.ReservedBalance || 0)
      : null;
    const payments = await PaymentHistory.aggregate([
      {
        $match: {
          HostID: hostId,
          Status: {
            $in: ["successful", "partially_refunded", "refunded"],
          },
        },
      },
      {
        $group: {
          _id: null,
          gross: { $sum: "$Amount" },
          refunded: { $sum: { $ifNull: ["$RefundedAmount", 0] } },
        },
      },
    ]);

    // Refund allocation vs payment RefundedAmount
    const refunds = await Refund.find({
      HostID: hostId,
      Status: "completed",
    }).lean();
    let allocSum = 0;
    for (const r of refunds) {
      const a = await RefundAllocation.aggregate([
        { $match: { RefundID: r._id } },
        { $group: { _id: null, s: { $sum: "$Amount" } } },
      ]);
      allocSum += a[0]?.s || 0;
    }
    const paymentRefunded = payments[0]?.refunded || 0;

    // Open payouts must have reserved funds
    const openPayouts = await Payout.find({
      HostID: hostId,
      Status: { $in: ["requested", "processing"] },
    }).lean();
    const openPayoutSum = openPayouts.reduce((s, p) => s + p.Amount, 0);
    const reserved = proj?.ReservedBalance || 0;
    if (openPayoutSum > reserved) {
      anomalies.push({
        hostId: String(hostId),
        type: "payout_without_reserve",
        openPayoutSum,
        reserved,
      });
    }
    if (duplicateLedger) {
      anomalies.push({
        hostId: String(hostId),
        type: "duplicate_ledger",
        count: duplicateLedger,
      });
    }
    if (Math.abs(allocSum - paymentRefunded) > 0 && refunds.length) {
      anomalies.push({
        hostId: String(hostId),
        type: "refund_allocation_mismatch",
        allocSum,
        paymentRefunded,
      });
    }
    if (proj && (proj.AvailableBalance < 0 || proj.ReservedBalance < 0)) {
      anomalies.push({
        hostId: String(hostId),
        type: "negative_balance",
        available: proj.AvailableBalance,
        reserved: proj.ReservedBalance,
      });
    }

    const row = {
      hostId: String(hostId),
      ledgerAvailable: ledgerAvail,
      projectedAvailable: proj?.AvailableBalance ?? null,
      projectedReserved: proj?.ReservedBalance ?? null,
      paymentGross: payments[0]?.gross || 0,
      paymentRefunded,
      allocSum,
      openPayoutSum,
      deltaProjection:
        projected == null
          ? "no_projection"
          : ledgerAvail - (proj.AvailableBalance + (proj.ReservedBalance || 0)),
    };
    report.push(row);

    if (!dryRun && proj && typeof row.deltaProjection === "number" && Math.abs(row.deltaProjection) > 0) {
      await HostBalance.updateOne(
        { HostID: hostId },
        {
          $set: {
            AvailableBalance: Math.max(0, ledgerAvail - (proj.ReservedBalance || 0)),
          },
          $inc: { Version: 1 },
        },
      );
      row.applied = true;
    }
  }

  console.log(
    JSON.stringify(
      { dryRun, hosts: report.length, anomalies, report },
      null,
      2,
    ),
  );
  if (anomalies.length) process.exitCode = 1;
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
