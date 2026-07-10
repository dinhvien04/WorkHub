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
  futureRange,
} = require('./helpers');
const bookingService = require('../services/bookingService');
const emailService = require('../services/emailService');
const emailTemplates = require('../services/emailTemplates');
const Branch = require('../models/Branch');

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
  emailService.clearDevOutbox();
});

describe('Email templates', () => {
  test('render booking + password templates', () => {
    const names = emailTemplates.listTemplates();
    expect(names).toContain('booking_confirmed');
    expect(names).toContain('password_reset');

    const pr = emailTemplates.render('password_reset', { otp: '123456' });
    expect(pr.subject).toMatch(/mật khẩu|password/i);
    expect(pr.text).toContain('123456');
    expect(pr.html).toContain('123456');

    const bc = emailTemplates.render('booking_created', {
      customerName: 'An',
      spaceName: 'Room A',
      startTime: new Date(),
      endTime: new Date(),
      totalAmount: 100000,
      bookingId: 'abc',
      baseUrl: 'http://localhost:3000',
    });
    expect(bc.html).toContain('Room A');
    expect(bc.html).toContain('booking/detail');
  });

  test('create booking queues transactional emails in dev outbox', async () => {
    const host = await createUser({ email: 'hemail@test.com', role: 'host' });
    const customer = await createUser({ email: 'cemail@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(5, 1);
    await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    // allow microtask for safeSend
    await new Promise((r) => setImmediate(r));
    const box = emailService.listDevOutbox();
    expect(box.length).toBeGreaterThanOrEqual(1);
    const subjects = box.map((e) => e.subject).join(' | ');
    expect(subjects).toMatch(/đặt chỗ|đơn/i);
  });
});

describe('Search zero-result payload', () => {
  test('empty search returns tips and popular cities', async () => {
    const host = await createUser({ email: 'hzero@test.com', role: 'host' });
    const { branch } = await seedHostSpace(host);
    await Branch.updateOne(
      { _id: branch._id },
      { $set: { CitySlug: 'ho-chi-minh', City: 'HCM', DistrictSlug: 'quan-1' } }
    );

    const res = await request(app).get(
      '/api/search?q=xyznoresult999&city=ho-chi-minh&minPrice=999999999'
    );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(0);
    expect(res.body.zeroResult).toBeTruthy();
    expect(res.body.zeroResult.tips.length).toBeGreaterThan(0);
    expect(res.body.zeroResult.suggestedActions.some((a) => a.action === 'clear_filters')).toBe(
      true
    );
  });
});

describe('Host onboarding CTAs', () => {
  test('checklist includes href/cta and progress', async () => {
    const host = await createUser({ email: 'honb@test.com', role: 'host', hostVerified: true });
    const { token } = agentWithAuth(app, host);
    const res = await request(app)
      .get('/api/host/onboarding')
      .set('Cookie', `authToken=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.progress).toBeGreaterThanOrEqual(0);
    expect(res.body.steps.length).toBeGreaterThan(3);
    const business = res.body.steps.find((s) => s.id === 'business');
    expect(business.href).toBe('/host/profile');
    expect(business.cta).toBeTruthy();
    expect(res.body.nextStep).toBeTruthy();
  });
});
