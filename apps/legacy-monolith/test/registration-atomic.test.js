'use strict';

const request = require('supertest');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  getApp,
  getCsrfPair,
  withCsrf,
} = require('./helpers');
const User = require('../models/User');
const CustomerProfile = require('../models/Customer_Profile');
const EmailVerificationToken = require('../models/EmailVerificationToken');
const OutboxEvent = require('../models/OutboxEvent');

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

describe('Registration atomicity', () => {
  test('successful customer register creates user + profile + verify token + outbox', async () => {
    const csrf = await getCsrfPair(app);
    const email = `reg-${Date.now()}@test.local`;
    const res = await withCsrf(request(app).post('/api/auth/register'), csrf).send({
      email,
      password: 'password-long-enough',
      fullName: 'Reg User',
      phone: '0901234567',
      role: 'customer',
    });
    expect(res.status).toBe(201);
    expect(res.body.requiresEmailVerification).toBe(true);

    const user = await User.findOne({ Email: email });
    expect(user).toBeTruthy();
    expect(user.Status).toBe('inactive');
    expect(user.EmailVerified).toBe(false);

    const profile = await CustomerProfile.findOne({ UserID: user._id });
    expect(profile).toBeTruthy();
    expect(profile.Phone).toBe('0901234567');

    const tokens = await EmailVerificationToken.find({ UserID: user._id });
    expect(tokens.length).toBe(1);

    const outbox = await OutboxEvent.find({
      IdempotencyKey: `register:${user._id}:verify-email`,
    });
    expect(outbox.length).toBe(1);
  });

  test('duplicate email does not create second account', async () => {
    const csrf = await getCsrfPair(app);
    const email = `dup-${Date.now()}@test.local`;
    const body = {
      email,
      password: 'password-long-enough',
      fullName: 'Dup',
      phone: '0901111111',
      role: 'customer',
    };
    const first = await withCsrf(request(app).post('/api/auth/register'), csrf).send(body);
    expect(first.status).toBe(201);

    const csrf2 = await getCsrfPair(app);
    const second = await withCsrf(request(app).post('/api/auth/register'), csrf2).send(body);
    expect(second.status).toBe(400);

    const count = await User.countDocuments({ Email: email });
    expect(count).toBe(1);
  });

  test('host register without document fails with no user left', async () => {
    const csrf = await getCsrfPair(app);
    const email = `host-nodoc-${Date.now()}@test.local`;
    const res = await withCsrf(request(app).post('/api/auth/register'), csrf).send({
      email,
      password: 'password-long-enough',
      fullName: 'Host NoDoc',
      phone: '0902222222',
      role: 'host',
      companyName: 'Co',
      taxCode: 'TAX',
      bankName: 'VCB',
      bankNumber: '123',
    });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ Email: email })).toBe(0);
  });
});
