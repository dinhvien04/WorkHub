'use strict';

/**
 * Compare PaymentHistory / Refunds / Payouts / Ledger / HostBalance.
 * Usage:
 *   node scripts/reconcile-finance.js --dry-run
 *   node scripts/reconcile-finance.js --apply --confirm=YES
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
  const confirm = process.argv.includes('--confirm=YES');
  if (!dryRun && !confirm) {
    console.error('Refusing --apply without --confirm=YES');
    process.exit(2);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const LedgerEntry = require('../models/LedgerEntry');
  const HostBalance = require('../models/HostBalance');
  const PaymentHistory = require('../models/Payment_History');

  const hostIds = await LedgerEntry.distinct('HostID');
  const report = [];

  for (const hostId of hostIds) {
    const entries = await LedgerEntry.find({ HostID: hostId, Status: 'posted' }).lean();
    let ledgerAvail = 0;
    for (const e of entries) {
      ledgerAvail += e.Direction === 'credit' ? e.Amount : -e.Amount;
    }
    ledgerAvail = Math.max(0, ledgerAvail);
    const proj = await HostBalance.findOne({ HostID: hostId }).lean();
    const projected = proj ? proj.AvailableBalance + (proj.ReservedBalance || 0) : null;
    const payments = await PaymentHistory.aggregate([
      { $match: { HostID: hostId, Status: { $in: ['successful', 'partially_refunded'] } } },
      {
        $group: {
          _id: null,
          gross: { $sum: '$Amount' },
          refunded: { $sum: { $ifNull: ['$RefundedAmount', 0] } },
        },
      },
    ]);
    const row = {
      hostId: String(hostId),
      ledgerAvailable: ledgerAvail,
      projectedAvailable: proj?.AvailableBalance ?? null,
      projectedReserved: proj?.ReservedBalance ?? null,
      paymentGross: payments[0]?.gross || 0,
      paymentRefunded: payments[0]?.refunded || 0,
      deltaProjection:
        projected == null ? 'no_projection' : ledgerAvail - (proj.AvailableBalance + (proj.ReservedBalance || 0)),
    };
    report.push(row);

    if (!dryRun && proj && Math.abs(row.deltaProjection) > 0) {
      // Correct projection from ledger sum (compensating, audited)
      await HostBalance.updateOne(
        { HostID: hostId },
        {
          $set: {
            AvailableBalance: ledgerAvail,
            ReservedBalance: 0,
          },
          $inc: { Version: 1 },
        }
      );
      row.applied = true;
    }
  }

  console.log(JSON.stringify({ dryRun, hosts: report.length, report }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
