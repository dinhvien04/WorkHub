'use strict';

/**
 * Seed demo coupons + feature flags (idempotent).
 * Usage: node scripts/seedDemoExtras.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const FeatureFlag = require('../models/FeatureFlag');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await Coupon.findOneAndUpdate(
    { Code: 'WELCOME10' },
    {
      Code: 'WELCOME10',
      Type: 'percent',
      Value: 10,
      MinOrderAmount: 50000,
      MaxDiscountAmount: 100000,
      Status: 'active',
      Description: 'Giảm 10% đơn từ 50k',
      FundedBy: 'platform',
      PerUserLimit: 3,
    },
    { upsert: true, new: true }
  );
  await Coupon.findOneAndUpdate(
    { Code: 'FLAT20K' },
    {
      Code: 'FLAT20K',
      Type: 'fixed',
      Value: 20000,
      MinOrderAmount: 100000,
      Status: 'active',
      Description: 'Giảm 20k cho đơn từ 100k',
      FundedBy: 'platform',
    },
    { upsert: true, new: true }
  );

  const flags = [
    { Key: 'booking_wizard', Enabled: true, Description: '3-step booking wizard' },
    { Key: 'favorites', Enabled: true, Description: 'Customer favorites' },
    { Key: 'host_calendar', Enabled: true, Description: 'Host calendar view' },
    { Key: 'messaging', Enabled: true, Description: 'Booking-scoped messaging' },
    { Key: 'coupons', Enabled: true, Description: 'Coupon codes' },
    { Key: 'pwa', Enabled: true, Description: 'PWA service worker' },
  ];
  for (const f of flags) {
    await FeatureFlag.findOneAndUpdate({ Key: f.Key }, f, { upsert: true });
  }
  console.log('Seeded coupons WELCOME10, FLAT20K and feature flags.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
