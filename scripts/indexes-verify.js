'use strict';

/**
 * List indexes for critical collections (verify after deploy).
 * Does not create indexes — models handle syncIndexes if enabled.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const COLLECTIONS = [
  'bookings',
  'booking_slots',
  'payment_histories',
  'ledger_entries',
  'webhook_events',
  'users',
  'spaces',
  'branches',
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  for (const name of COLLECTIONS) {
    try {
      const idxs = await db.collection(name).indexes();
      console.log('\n##', name);
      for (const i of idxs) {
        console.log(' ', i.name, JSON.stringify(i.key));
      }
    } catch (err) {
      console.log('\n##', name, '—', err.message);
    }
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
