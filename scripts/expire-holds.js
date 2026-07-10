'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const { expireStaleHolds } = require('../services/bookingService');
  const result = await expireStaleHolds();
  console.log(JSON.stringify({ ok: true, ...result, at: new Date().toISOString() }));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
