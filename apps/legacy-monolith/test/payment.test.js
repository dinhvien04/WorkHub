'use strict';

const paymentService = require('../services/paymentService');
const PaymentHistory = require('../models/Payment_History');
const Booking = require('../models/Booking');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  seedHostSpace,
  futureRange,
  getApp,
  agentWithAuth,
  getCsrfPair,
  withCsrf,
} = require('./helpers');
const request = require('supertest');

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

async function setupBooking(status = 'pending') {
  const host = await createUser({ email: `h-${Date.now()}@test.com`, role: 'host' });
  const customer = await createUser({ email: `c-${Date.now()}@test.com`, role: 'customer' });
  const { space } = await seedHostSpace(host);
  const { start, end } = futureRange(2, 2);
  const booking = await Booking.create({
    CustomerID: customer._id,
    SpaceID: space._id,
    HostID: host._id,
    StartTime: start,
    EndTime: end,
    TotalAmount: 100000,
    DepositAmount: 30000,
    Status: status,
  });
  return { host, customer, booking };
}

describe('Payment calculations & APIs', () => {
  test('pending/failed/refunded not counted; successful counted', async () => {
    const { host, customer, booking } = await setupBooking();
    await PaymentHistory.create([
      {
        BookingID: booking._id,
        CustomerID: customer._id,
        HostID: host._id,
        TransactionCode: 'T1',
        Amount: 30000,
        PaymentType: 'deposit',
        Status: 'pending',
      },
      {
        BookingID: booking._id,
        CustomerID: customer._id,
        HostID: host._id,
        TransactionCode: 'T2',
        Amount: 10000,
        PaymentType: 'deposit',
        Status: 'failed',
      },
      {
        BookingID: booking._id,
        CustomerID: customer._id,
        HostID: host._id,
        TransactionCode: 'T3',
        Amount: 20000,
        PaymentType: 'deposit',
        Status: 'refunded',
      },
      {
        BookingID: booking._id,
        CustomerID: customer._id,
        HostID: host._id,
        TransactionCode: 'T4',
        Amount: 25000,
        PaymentType: 'deposit',
        Status: 'successful',
        PaidAt: new Date(),
      },
    ]);
    expect(await paymentService.getSuccessfulPaidAmount(booking._id)).toBe(25000);
  });

  test('idempotency key required', async () => {
    const { customer, booking } = await setupBooking();
    await expect(
      paymentService.createPendingPayment({
        customerId: customer._id,
        bookingId: booking._id,
        paymentType: 'deposit',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('same idempotency key returns same payment', async () => {
    const { customer, booking } = await setupBooking();
    const r1 = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-key-1234567890',
    });
    const r2 = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-key-1234567890',
    });
    expect(r2.duplicate).toBe(true);
    expect(String(r1.payment._id)).toBe(String(r2.payment._id));
  });

  test('verify and reject ownership', async () => {
    const { host, customer, booking } = await setupBooking();
    const other = await createUser({ email: 'other@test.com', role: 'host' });
    const { payment } = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-verify-11111111',
    });

    await expect(paymentService.verifyPayment(other._id, payment._id)).rejects.toMatchObject({
      statusCode: 404,
    });

    const verified = await paymentService.verifyPayment(host._id, payment._id);
    expect(verified.Status).toBe('successful');

    await expect(paymentService.verifyPayment(host._id, payment._id)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('reject pending', async () => {
    const { host, customer, booking } = await setupBooking();
    const { payment } = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-reject-11111111',
    });
    const rejected = await paymentService.rejectPayment(host._id, payment._id, 'bad proof');
    expect(rejected.Status).toBe('failed');
  });

  test('host API verify/reject routes', async () => {
    const { host, customer, booking } = await setupBooking();
    const { payment } = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-route-11111111',
    });
    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);

    const res = await withCsrf(
      request(app).put(`/api/hosts/payments/${payment._id}/verify`),
      csrf,
      `authToken=${token}`
    );
    expect(res.status).toBe(200);
    expect(res.body.payment.Status).toBe('successful');
  });

  test('revenue metrics use successful only', async () => {
    const { host, customer, booking } = await setupBooking();
    await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-rev-1111111111',
    });
    let metrics = await paymentService.getHostRevenueMetrics(host._id);
    expect(metrics.actualRevenue).toBe(0);
    expect(metrics.pendingAmount).toBe(30000);

    const pending = await PaymentHistory.findOne({ BookingID: booking._id, Status: 'pending' });
    await paymentService.verifyPayment(host._id, pending._id);
    metrics = await paymentService.getHostRevenueMetrics(host._id);
    expect(metrics.actualRevenue).toBe(30000);
    expect(metrics.pendingAmount).toBe(0);
  });
});
