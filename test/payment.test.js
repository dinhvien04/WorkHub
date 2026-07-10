'use strict';

process.env.NODE_ENV = 'test';
process.env.DISABLE_CSRF = '1';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test_jwt_secret_key_at_least_32_characters_long_for_workhub';

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
} = require('./helpers');

beforeAll(async () => {
  await startMemoryMongo();
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

describe('Payment calculations', () => {
  test('pending/failed/refunded do not count as paid; successful does', async () => {
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

    const paid = await paymentService.getSuccessfulPaidAmount(booking._id);
    expect(paid).toBe(25000);
    const progress = await paymentService.getPaymentProgress(booking._id);
    expect(progress.paidAmount).toBe(25000);
    expect(progress.remainingAmount).toBe(75000);
  });

  test('cannot pay over TotalAmount', async () => {
    const { customer, booking } = await setupBooking();
    await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: booking.HostID,
      TransactionCode: 'T5',
      Amount: 100000,
      PaymentType: 'full_payment',
      Status: 'successful',
      PaidAt: new Date(),
    });

    await expect(
      paymentService.createPendingPayment({
        customerId: customer._id,
        bookingId: booking._id,
        paymentType: 'deposit',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('double-submit same stage returns same pending payment', async () => {
    const { customer, booking } = await setupBooking();
    const r1 = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-1',
    });
    const r2 = await paymentService.createPendingPayment({
      customerId: customer._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: 'idem-1',
    });
    expect(r2.duplicate).toBe(true);
    expect(String(r1.payment._id)).toBe(String(r2.payment._id));
    const count = await PaymentHistory.countDocuments({ BookingID: booking._id });
    expect(count).toBe(1);
  });

  test('host cannot verify another host payment', async () => {
    const { host, customer, booking } = await setupBooking();
    const otherHost = await createUser({ email: 'other@test.com', role: 'host' });
    const payment = await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: host._id,
      TransactionCode: 'T6',
      Amount: 30000,
      PaymentType: 'deposit',
      Status: 'pending',
    });

    await expect(paymentService.verifyPayment(otherHost._id, payment._id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
