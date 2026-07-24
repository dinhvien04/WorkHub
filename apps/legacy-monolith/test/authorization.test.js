'use strict';

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
  getCsrfPair,
  withCsrf,
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

describe('Customer authorization', () => {
  test('self profile ok; cross profile 403', async () => {
    const a = await createUser({ email: 'a@test.com', role: 'customer' });
    const b = await createUser({ email: 'b@test.com', role: 'customer' });
    const { token: tokenA } = agentWithAuth(app, a);

    const own = await request(app)
      .get('/api/customers/me/profile')
      .set('Cookie', `authToken=${tokenA}`);
    expect(own.status).toBe(200);

    const cross = await request(app)
      .get(`/api/customers/${b._id}/profile`)
      .set('Cookie', `authToken=${tokenA}`);
    expect(cross.status).toBe(403);
  });

  test('cannot act on B booking', async () => {
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
    const csrf = await getCsrfPair(app);

    const cancel = await withCsrf(
      request(app).put(`/api/customers/${b._id}/bookings/${booking._id}/cancel`),
      csrf,
      `authToken=${tokenA}`
    );
    expect(cancel.status).toBe(403);
  });
});

describe('Host authorization', () => {
  test('host A cannot confirm booking of host B', async () => {
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
    const csrf = await getCsrfPair(app);
    const confirm = await withCsrf(
      request(app).put(`/api/hosts/bookings/${booking._id}/confirm`),
      csrf,
      `authToken=${tokenA}`
    );
    expect([403, 404]).toContain(confirm.status);
  });

  test('dashboard branch ownership', async () => {
    const hostA = await createUser({ email: 'ha2@test.com', role: 'host' });
    const hostB = await createUser({ email: 'hb2@test.com', role: 'host' });
    const { branch: branchB } = await seedHostSpace(hostB);
    const { token: tokenA } = agentWithAuth(app, hostA);

    const res = await request(app)
      .get(`/api/hosts/dashboard-stats?branchId=${branchB._id}`)
      .set('Cookie', `authToken=${tokenA}`);
    expect([403, 404]).toContain(res.status);
  });

  test('unverified host blocked from host API', async () => {
    const host = await createUser({
      email: 'hun@test.com',
      role: 'host',
      hostVerified: false,
      status: 'active',
    });
    // force active but not verified
    const HostProfile = require('../models/Host_Profile');
    await HostProfile.updateOne({ UserID: host._id }, { IsVerified: false });
    host.Status = 'active';
    await host.save();

    const { token } = agentWithAuth(app, host);
    const res = await request(app).get('/api/hosts/branches').set('Cookie', `authToken=${token}`);
    expect(res.status).toBe(403);
  });

  test('host A cannot see host B payments', async () => {
    const hostA = await createUser({ email: 'ha3@test.com', role: 'host' });
    const hostB = await createUser({ email: 'hb3@test.com', role: 'host' });
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
  });
});
