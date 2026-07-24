"use strict";

/**
 * Dry-run migration: copy lowercase fields to canonical PascalCase when missing.
 *
 * Usage:
 *   node scripts/migrateCanonicalFields.js --dry-run
 *   node scripts/migrateCanonicalFields.js --apply
 *
 * Backup DB before --apply.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const dryRun = !process.argv.includes("--apply");

const FIELD_MAPS = {
  bookings: [
    ["status", "Status"],
    ["hostID", "HostID"],
    ["customerID", "CustomerID"],
    ["spaceID", "SpaceID"],
    ["startTime", "StartTime"],
    ["endTime", "EndTime"],
  ],
  spaces: [
    ["hostID", "HostID"],
    ["branchID", "BranchID"],
    ["spaceCode", "SpaceCode"],
    ["status", "Status"],
  ],
  branches: [
    ["hostID", "HostID"],
    ["status", "Status"],
  ],
};

async function migrateCollection(db, name, pairs) {
  const col = db.collection(name);
  let need = 0;
  let updated = 0;
  const cursor = col.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const $set = {};
    for (const [from, to] of pairs) {
      if (
        doc[from] !== undefined &&
        (doc[to] === undefined || doc[to] === null)
      ) {
        $set[to] = doc[from];
      }
    }
    if (Object.keys($set).length) {
      need += 1;
      if (!dryRun) {
        await col.updateOne({ _id: doc._id }, { $set });
        updated += 1;
      }
    }
  }
  return { need, updated };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(dryRun ? "DRY-RUN mode" : "APPLY mode");
  for (const [name, pairs] of Object.entries(FIELD_MAPS)) {
    try {
      const r = await migrateCollection(db, name, pairs);
      console.log(
        `${name}: documents needing fix=${r.need}, updated=${r.updated}`,
      );
    } catch (e) {
      console.warn(`${name}: skip (${e.message})`);
    }
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
