'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  futureRange,
  getApp,
  getCsrfPair,
  withCsrf,
} = require('./helpers');
const bookingService = require('../services/bookingService');
const rescheduleService = require('../services/rescheduleService');
const refundService = require('../services/refundService');
const paymentService = require('../services/paymentService');
const ledgerService = require('../services/ledgerService');
const disputeService = require('../services/disputeService');
const searchService = require('../services/searchService');
const staffService = require('../services/staffService');

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

describe('Search API', () => {
  test('public search returns pagination', async () => {
    const host = await createUser({ email: 'hs@test.com', role: 'host' });
    await seedHostSpace(host);
    const res = await request(app).get('/api/search?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeTruthy();
  });
});

describe('Reschedule', () => {
  test('customer can reschedule booking', async () => {
    const host = await createUser({ email: 'hr@test.com', role: 'host' });
    const customer = await createUser({ email: 'cr@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { start: s2, end: e2 } = futureRange(5, 1);
    const result = await rescheduleService.rescheduleBooking({
      bookingId: booking._id,
      userId: customer._id,
      role: 'customer',
      startTime: s2,
      endTime: e2,
    });
    const updated = result.booking || result;
    expect(new Date(updated.StartTime).getTime()).toBe(s2.getTime());
    expect(result.previous).toBeTruthy();
  });
});

describe('Refund + ledger', () => {
  test('refund cannot exceed successful paid', async () => {
    const host = await createUser({ email: 'hf@test.com', role: 'host' });
    const customer = await createUser({ email: 'cf@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(4, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const { payment } = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-refund-test-00001',
    });
    await paymentService.verifyPayment(host._id, payment._id);
    await ledgerService.postEntry({
      hostId: host._id,
      customerId: customer._id,
      bookingId: booking._id,
      paymentId: payment._id,
      type: 'payment',
      amount: payment.Amount,
      direction: 'credit',
      idempotencyKey: `ledger-pay-${payment._id}`,
    });

    await expect(
      refundService.requestRefund({
        bookingId: booking._id,
        userId: customer._id,
        role: 'customer',
        amount: payment.Amount + 1000000,
        reason: 'too much',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    const refund = await refundService.requestRefund({
      bookingId: booking._id,
      userId: customer._id,
      role: 'customer',
      amount: Math.min(payment.Amount, 10000),
      reason: 'ok',
      idempotencyKey: 'idem-ref-ok-00000001',
    });
    const done = await refundService.processRefund({
      refundId: refund._id,
      actorId: host._id,
      approve: true,
      role: 'host',
      transferReference: 'TEST-PLATFORM-REF',
    });
    expect(done.Status).toBe('completed');
  });
});

describe('Dispute', () => {
  test('open dispute', async () => {
    const host = await createUser({ email: 'hd@test.com', role: 'host' });
    const customer = await createUser({ email: 'cd@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(6, 1);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    const d = await disputeService.openDispute({
      bookingId: booking._id,
      userId: customer._id,
      reason: 'Phòng không đúng mô tả',
    });
    expect(d.Status).toBe('open');
  });
});

describe('Staff invite', () => {
  test('invite and accept', async () => {
    const owner = await createUser({ email: 'owner@test.com', role: 'host' });
    const staffUser = await createUser({ email: 'staff@test.com', role: 'customer' });
    const { staff, inviteToken } = await staffService.inviteStaff({
      ownerId: owner._id,
      email: 'staff@test.com',
      role: 'receptionist',
    });
    expect(staff.Status).toBe('invited');
    const accepted = await staffService.acceptInvite({
      userId: staffUser._id,
      token: inviteToken,
    });
    expect(accepted.Status).toBe('active');
  });
});

describe('Platform pages', () => {
  test('reception and support shells', async () => {
    expect((await request(app).get('/support')).status).toBe(200);
    expect((await request(app).get('/compare')).status).toBe(200);
  });
});
