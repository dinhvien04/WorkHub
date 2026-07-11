'use strict';

process.env.NODE_ENV = 'test';
process.env.ENABLE_TRANSACTIONS = 'true';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test_jwt_secret_key_at_least_32_characters_long_for_workhub';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.setTimeout(180000);

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replset.getUri());
  await mongoose.connection.db.admin().command({ ping: 1 });
  const env = require('../config/env');
  env.ENABLE_TRANSACTIONS = true;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

describe('membership-transactions', () => {
  test('credit + ledger are atomic; same key different hours conflicts', async () => {
    const User = require('../models/User');
    const { MembershipPlan, Membership } = require('../models/Membership');
    const MembershipCreditLedger = require('../models/MembershipCreditLedger');
    const membershipService = require('../services/membershipService');

    const user = await User.create({
      Email: `m-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'Member',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });
    const plan = await MembershipPlan.create({
      Code: `FREE-${Date.now()}`,
      Name: 'Free',
      MonthlyPrice: 0,
      IncludedHours: 10,
      Status: 'active',
    });
    const membership = await Membership.create({
      UserID: user._id,
      PlanID: plan._id,
      CreditsRemaining: 10,
      StartsAt: new Date(),
      EndsAt: new Date(Date.now() + 30 * 86400000),
      Status: 'active',
    });

    await membershipService.postCreditEntry({
      membershipId: membership._id,
      userId: user._id,
      type: 'consume',
      hours: 2,
      direction: 'debit',
      description: 'use 2h',
      idempotencyKey: `consume-${membership._id}-1`,
    });

    const m = await Membership.findById(membership._id);
    expect(m.CreditsRemaining).toBe(8);
    const ledgers = await MembershipCreditLedger.find({
      IdempotencyKey: `consume-${membership._id}-1`,
    });
    expect(ledgers.length).toBe(1);

    await membershipService.postCreditEntry({
      membershipId: membership._id,
      userId: user._id,
      type: 'consume',
      hours: 2,
      direction: 'debit',
      idempotencyKey: `consume-${membership._id}-1`,
    });
    const m2 = await Membership.findById(membership._id);
    expect(m2.CreditsRemaining).toBe(8);

    await expect(
      membershipService.postCreditEntry({
        membershipId: membership._id,
        userId: user._id,
        type: 'consume',
        hours: 3,
        direction: 'debit',
        idempotencyKey: `consume-${membership._id}-1`,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
