'use strict';

process.env.NODE_ENV = 'test';
process.env.DISABLE_CSRF = '1';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test_jwt_secret_key_at_least_32_characters_long_for_workhub';

const request = require('supertest');
const Booking = require('../models/Booking');
const PaymentHistory = require('../models/Payment_History');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  agentWithAuth,
  seedHostSpace,
  futureRange,
  getApp,
} = require('./helpers');

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

describe('Customer authorization (IDOR)', () => {
  test('customer A can view own profile; cannot view B', async () => {
    const a = await createUser({ email: 'a@test.com', role: 'customer' });
    const b = await createUser({ email: 'b@test.com', role: 'customer' });
    const { token: tokenA } = agentWithAuth(app, a);

    const own = await request(app)
      .get('/api/customers/me/profile')
      .set('Cookie', `authToken=${tokenA}`);
    expect(own.status).toBe(200);
    expect(own.body.user.Email).toBe('a@test.com');

    const cross = await request(app)
      .get(`/api/customers/${b._id}/profile`)
      .set('Cookie', `authToken=${tokenA}`);
    expect(cross.status).toBe(403);
  });

  test('customer A cannot update B profile', async () => {
    const a = await createUser({ email: 'a2@test.com', role: 'customer' });
    const b = await createUser({ email: 'b2@test.com', role: 'customer' });
    const { token: tokenA } = agentWithAuth(app, a);

    const res = await request(app)
      .put(`/api/customers/${b._id}/profile`)
      .set('Cookie', `authToken=${tokenA}`)
      .send({ FullName: 'Hacked', Phone: '0999' });
    expect(res.status).toBe(403);
  });

  test('customer A cannot view/cancel/pay/review booking of B', async () => {
    const a = await createUser({ email: 'a3@test.com', role: 'customer' });
    const b = await createUser({ email: 'b3@test.com', role: 'customer' });
    const host = await createUser({ email: 'h@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(3, 2);

    const booking = await Booking.create({
      CustomerID: b._id,
      SpaceID: space._id,
      HostID: host._id,
      StartTime: start,
      EndTime: end,
      TotalAmount: 200000,
      DepositAmount: 60000,
      Status: 'pending',
    });

    const { token: tokenA } = agentWithAuth(app, a);

    const list = await request(app)
      .get(`/api/customers/${b._id}/bookings`)
      .set('Cookie', `authToken=${tokenA}`);
    expect(list.status).toBe(403);

    const cancel = await request(app)
      .put(`/api/customers/${b._id}/bookings/${booking._id}/cancel`)
      .set('Cookie', `authToken=${tokenA}`);
    expect(cancel.status).toBe(403);

    const pay = await request(app)
      .put(`/api/customers/${b._id}/bookings/${booking._id}/pay`)
      .set('Cookie', `authToken=${tokenA}`);
    expect(pay.status).toBe(403);

    const review = await request(app)
      .post(`/api/customers/${b._id}/bookings/${booking._id}/review`)
      .set('Cookie', `authToken=${tokenA}`)
      .send({ rating: 5, comment: 'x' });
    expect(review.status).toBe(403);

    const confirm = await request(app)
      .post('/api/customers/me/booking/confirm')
      .set('Cookie', `authToken=${tokenA}`)
      .send({ bookingId: booking._id, paymentType: 'deposit' });
    expect([403, 404]).toContain(confirm.status);
  });

  test('create booking always uses token user, not URL userId', async () => {
    const a = await createUser({ email: 'a4@test.com', role: 'customer' });
    const b = await createUser({ email: 'b4@test.com', role: 'customer' });
    const host = await createUser({ email: 'h2@test.com', role: 'host' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(4, 1);
    const { token: tokenA } = agentWithAuth(app, a);

    const res = await request(app)
      .post(`/api/customers/${b._id}/bookings`)
      .set('Cookie', `authToken=${tokenA}`)
      .send({
        spaceId: space._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });

    expect(res.status).toBe(403);
  });
});

describe('Host authorization', () => {
  test('host A cannot confirm/checkin/cancel booking of host B', async () => {
    const hostA = await createUser({ email: 'ha@test.com', role: 'host' });
    const hostB = await createUser({ email: 'hb@test.com', role: 'host' });
    const customer = await createUser({ email: 'c@test.com', role: 'customer' });
    const { space } = await seedHostSpace(hostB);
    const { start, end } = futureRange(5, 2);

    const booking = await Booking.create({
      CustomerID: customer._id,
      SpaceID: space._id,
      HostID: hostB._id,
      StartTime: start,
      EndTime: end,
      TotalAmount: 200000,
      DepositAmount: 60000,
      Status: 'pending',
    });

    const { token: tokenA } = agentWithAuth(app, hostA);

    const confirm = await request(app)
      .put(`/api/hosts/bookings/${booking._id}/confirm`)
      .set('Cookie', `authToken=${tokenA}`);
    expect([403, 404]).toContain(confirm.status);

    booking.Status = 'confirmed';
    await booking.save();

    const checkin = await request(app)
      .put(`/api/hosts/bookings/${booking._id}/checkin`)
      .set('Cookie', `authToken=${tokenA}`);
    expect([403, 404]).toContain(checkin.status);

    booking.Status = 'pending';
    await booking.save();

    const cancel = await request(app)
      .put(`/api/hosts/bookings/${booking._id}/cancel`)
      .set('Cookie', `authToken=${tokenA}`);
    expect([403, 404]).toContain(cancel.status);
  });

  test('host A cannot see host B payments', async () => {
    const hostA = await createUser({ email: 'ha2@test.com', role: 'host' });
    const hostB = await createUser({ email: 'hb2@test.com', role: 'host' });
    const customer = await createUser({ email: 'c2@test.com', role: 'customer' });
    const { space } = await seedHostSpace(hostB);
    const { start, end } = futureRange(6, 1);

    const booking = await Booking.create({
      CustomerID: customer._id,
      SpaceID: space._id,
      HostID: hostB._id,
      StartTime: start,
      EndTime: end,
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: 'pending',
    });

    await PaymentHistory.create({
      BookingID: booking._id,
      CustomerID: customer._id,
      HostID: hostB._id,
      TransactionCode: 'TXN-TEST-1',
      Amount: 30000,
      PaymentType: 'deposit',
      Status: 'successful',
      PaidAt: new Date(),
    });

    const paymentService = require('../services/paymentService');
    const { payments } = await paymentService.listHostPayments(hostA._id, { page: 1, limit: 50 });
    expect(payments.length).toBe(0);

    const forB = await paymentService.listHostPayments(hostB._id, { page: 1, limit: 50 });
    expect(forB.payments.length).toBe(1);
  });

  test('host A cannot delete image of host B branch', async () => {
    const hostA = await createUser({ email: 'ha3@test.com', role: 'host' });
    const hostB = await createUser({ email: 'hb3@test.com', role: 'host' });
    const { branch } = await seedHostSpace(hostB);
    const { token: tokenA } = agentWithAuth(app, hostA);

    const res = await request(app)
      .post(`/api/hosts/branches/${branch._id}/delete-image`)
      .set('Cookie', `authToken=${tokenA}`)
      .send({ imageUrl: branch.Images[0] });

    expect([403, 404]).toContain(res.status);
  });
});
