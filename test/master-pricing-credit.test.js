'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
  absoluteRange,
} = require('./helpers');
const Space = require('../models/Space');
const PricingRule = require('../models/PricingRule');
const { MembershipPlan, Membership } = require('../models/Membership');
const MembershipCreditLedger = require('../models/MembershipCreditLedger');
const pricingService = require('../services/pricingService');
const membershipService = require('../services/membershipService');
const { quoteBooking } = require('../services/bookingQuoteService');

let app;

beforeAll(async () => {
  await startMemoryMongo();
  app = getApp();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearDb();
});

describe('Duration pricing tiers', () => {
  test('selects half-day package when cheaper than hourly', async () => {
    const host = await createUser({ email: 'ph@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    await Space.updateOne(
      { _id: space._id },
      { $set: { PricePerHour: 100000, PricePerHalfDay: 350000 } }
    );
    const fresh = await Space.findById(space._id).lean();

    // 4 hours: half-day 350k < hourly 400k
    const day = new Date();
    day.setDate(day.getDate() + 5);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 9, 0, 13, 0);

    const q = await pricingService.quotePrice({
      hostId: host._id,
      spaceId: fresh._id,
      branchId: fresh.BranchID,
      start,
      end,
      basePricePerHour: fresh.PricePerHour,
      durationPrices: {
        PricePerHalfDay: fresh.PricePerHalfDay,
        PricePerDay: fresh.PricePerDay,
        PricePerWeek: fresh.PricePerWeek,
        PricePerMonth: fresh.PricePerMonth,
      },
    });
    expect(q.hours).toBe(4);
    expect(q.durationTier).toBe('half_day');
    expect(q.totalAmount).toBe(350000);

    const bookingQ = await quoteBooking({
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(bookingQ.ok).toBe(true);
    expect(bookingQ.durationTier).toBe('half_day');
    expect(bookingQ.baseAmount).toBe(350000);
  });

  test('daily package for 8h booking', async () => {
    const host = await createUser({ email: 'pd@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    await Space.updateOne(
      { _id: space._id },
      { $set: { PricePerHour: 100000, PricePerDay: 600000 } }
    );
    const fresh = await Space.findById(space._id).lean();
    const day = new Date();
    day.setDate(day.getDate() + 6);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 8, 0, 16, 0);

    const q = await pricingService.quotePrice({
      hostId: host._id,
      spaceId: fresh._id,
      branchId: fresh.BranchID,
      start,
      end,
      basePricePerHour: 100000,
      durationPrices: {
        PricePerDay: 600000,
        PricePerHalfDay: null,
        PricePerWeek: null,
        PricePerMonth: null,
      },
    });
    expect(q.hours).toBe(8);
    expect(q.durationTier).toBe('daily');
    expect(q.totalAmount).toBe(600000);
  });

  test('falls back to hourly when no package set', async () => {
    const host = await createUser({ email: 'ph2@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    const day = new Date();
    day.setDate(day.getDate() + 3);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 10, 0, 12, 0);
    const q = await pricingService.quotePrice({
      hostId: host._id,
      spaceId: space._id,
      branchId: space.BranchID,
      start,
      end,
      basePricePerHour: 100000,
      durationPrices: {},
    });
    expect(q.durationTier).toBe('hourly');
    expect(q.totalAmount).toBe(200000);
  });
});

describe('Pricing rule draft + preview + publish', () => {
  test('create defaults to draft; preview shows delta; publish activates', async () => {
    const host = await createUser({ email: 'pr@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    const createRes = await withCsrf(
      request(app).post('/api/host/pricing-rules'),
      csrf,
      `authToken=${token}`
    ).send({
      spaceId: String(space._id),
      name: 'Peak x1.5',
      type: 'peak_hour',
      multiplier: 1.5,
      priority: 10,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.rule.Status).toBe('draft');
    const ruleId = createRes.body.rule._id;

    // Active quote must NOT apply draft
    const day = new Date();
    day.setDate(day.getDate() + 7);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 10, 0, 12, 0);

    const activeQuote = await pricingService.quotePrice({
      hostId: host._id,
      spaceId: space._id,
      branchId: space.BranchID,
      start,
      end,
      basePricePerHour: 100000,
    });
    expect(activeQuote.totalAmount).toBe(200000);
    expect(activeQuote.appliedRules).toHaveLength(0);

    // Preview with draft id
    const previewRes = await withCsrf(
      request(app).post('/api/host/pricing-rules/preview'),
      csrf,
      `authToken=${token}`
    ).send({
      spaceId: String(space._id),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      draftRuleId: ruleId,
    });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.preview.withoutRule.totalAmount).toBe(200000);
    expect(previewRes.body.preview.withRule.totalAmount).toBe(300000);
    expect(previewRes.body.preview.delta).toBe(100000);

    // Publish
    const pubRes = await withCsrf(
      request(app).put(`/api/host/pricing-rules/${ruleId}/publish`),
      csrf,
      `authToken=${token}`
    ).send({});
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.rule.Status).toBe('active');

    const after = await pricingService.quotePrice({
      hostId: host._id,
      spaceId: space._id,
      branchId: space.BranchID,
      start,
      end,
      basePricePerHour: 100000,
    });
    expect(after.totalAmount).toBe(300000);
    expect(after.appliedRules.some((r) => r.name === 'Peak x1.5')).toBe(true);
  });

  test('preview unsaved rule payload without persisting', async () => {
    const host = await createUser({ email: 'pr2@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    const day = new Date();
    day.setDate(day.getDate() + 4);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 14, 0, 16, 0);

    const preview = await pricingService.previewPricingRule({
      hostId: host._id,
      spaceId: space._id,
      branchId: space.BranchID,
      start,
      end,
      basePricePerHour: 100000,
      rule: { name: 'Corp', type: 'corporate', multiplier: 0.9, priority: 5 },
    });
    expect(preview.withRule.totalAmount).toBe(180000);
    expect(preview.delta).toBe(-20000);
    const count = await PricingRule.countDocuments({ HostID: host._id });
    expect(count).toBe(0);
  });
});

describe('Membership credit ledger', () => {
  test('subscribe grants via ledger; consume posts debit; no direct balance edit path', async () => {
    await MembershipPlan.create({
      Name: 'Pro',
      Code: 'PRO',
      MonthlyPrice: 500000,
      IncludedHours: 20,
      Status: 'active',
    });
    const customer = await createUser({ email: 'mc@test.com', role: 'customer' });

    const m = await membershipService.subscribe({ userId: customer._id, planCode: 'PRO' });
    expect(m.CreditsRemaining).toBe(20);

    const grants = await MembershipCreditLedger.find({
      UserID: customer._id,
      Type: 'grant',
    }).lean();
    expect(grants).toHaveLength(1);
    expect(grants[0].Hours).toBe(20);
    expect(grants[0].Direction).toBe('credit');
    expect(grants[0].BalanceAfter).toBe(20);

    const { membership, entry } = await membershipService.consumeCredit(customer._id, 3, {
      idempotencyKey: 'test-consume-3',
    });
    expect(membership.CreditsRemaining).toBe(17);
    expect(entry.Type).toBe('consume');
    expect(entry.Direction).toBe('debit');
    expect(entry.BalanceAfter).toBe(17);

    // Idempotent re-consume
    const again = await membershipService.consumeCredit(customer._id, 3, {
      idempotencyKey: 'test-consume-3',
    });
    expect(again.membership.CreditsRemaining).toBe(17);

    await expect(membershipService.consumeCredit(customer._id, 100)).rejects.toMatchObject({
      statusCode: 400,
    });

    const ledger = await membershipService.listCreditLedger(customer._id, { page: 1, limit: 20 });
    expect(ledger.total).toBeGreaterThanOrEqual(2);
  });

  test('expire credits zeros balance via ledger', async () => {
    await MembershipPlan.create({
      Name: 'Lite',
      Code: 'LITE',
      MonthlyPrice: 100000,
      IncludedHours: 5,
      Status: 'active',
    });
    const customer = await createUser({ email: 'me@test.com', role: 'customer' });
    const m = await membershipService.subscribe({ userId: customer._id, planCode: 'LITE' });
    expect(m.CreditsRemaining).toBe(5);

    const { membership, entry } = await membershipService.expireCredits(m._id);
    expect(membership.CreditsRemaining).toBe(0);
    expect(membership.Status).toBe('expired');
    expect(entry.Type).toBe('expire');
    expect(entry.Hours).toBe(5);
  });

  test('GET /api/membership/credits returns ledger', async () => {
    await MembershipPlan.create({
      Name: 'Basic',
      Code: 'BASIC2',
      MonthlyPrice: 100000,
      IncludedHours: 8,
      Status: 'active',
    });
    const customer = await createUser({ email: 'api-m@test.com', role: 'customer' });
    await membershipService.subscribe({ userId: customer._id, planCode: 'BASIC2' });
    const { token } = agentWithAuth(app, customer);

    const res = await request(app)
      .get('/api/membership/credits')
      .set('Cookie', `authToken=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].Type).toBe('grant');
  });
});
