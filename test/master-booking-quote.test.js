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
const AddOn = require('../models/AddOn');
const Space = require('../models/Space');
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

describe('Booking quote / price breakdown', () => {
  test('service + GET/POST API return lines deposit and policy', async () => {
    const host = await createUser({ email: 'hq@test.com', role: 'host' });
    const { space, branch } = await seedHostSpace(host);
    await Space.updateOne(
      { _id: space._id },
      { $set: { FreeCancelHours: 12, InstantBook: true, Amenities: ['Wifi', 'Máy chiếu'] } }
    );
    await AddOn.create({
      HostID: host._id,
      BranchID: branch._id,
      Name: 'Coffee',
      Price: 20000,
      Unit: 'booking',
      Status: 'active',
    });

    const day = new Date();
    day.setDate(day.getDate() + 4);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 10, 0, 12, 0);

    const quote = await quoteBooking({
      spaceId: space._id,
      startTime: start,
      endTime: end,
      addOns: [],
    });
    expect(quote.ok).toBe(true);
    expect(quote.hours).toBe(2);
    expect(quote.baseAmount).toBe(200000); // 100k * 2h
    expect(quote.totalAmount).toBe(200000);
    expect(quote.depositAmount).toBeGreaterThan(0);
    expect(quote.lines.some((l) => l.key === 'base')).toBe(true);
    expect(quote.lines.some((l) => l.key === 'deposit')).toBe(true);
    expect(quote.freeCancelHours).toBe(12);
    expect(quote.instantBook).toBe(true);
    expect(quote.policy.summary).toMatch(/12/);

    const getRes = await request(app)
      .get('/api/bookings/quote')
      .query({
        spaceId: String(space._id),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
    expect(getRes.status).toBe(200);
    expect(getRes.body.quote.totalAmount).toBe(200000);

    const csrf = await getCsrfPair(app);
    const addon = await AddOn.findOne({ HostID: host._id });
    const postRes = await withCsrf(request(app).post('/api/bookings/quote'), csrf).send({
      spaceId: String(space._id),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      addOns: [{ addOnId: String(addon._id), quantity: 2 }],
    });
    expect(postRes.status).toBe(200);
    expect(postRes.body.quote.addOnsTotal).toBe(40000);
    expect(postRes.body.quote.totalAmount).toBe(240000);
  });

  test('wizard page and detail amenities/policy badges', async () => {
    const host = await createUser({ email: 'hwiz@test.com', role: 'host' });
    const { space, branch } = await seedHostSpace(host);
    await Space.updateOne(
      { _id: space._id },
      { $set: { Amenities: ['Wifi', 'Whiteboard'], InstantBook: true, FreeCancelHours: 24 } }
    );
    const Branch = require('../models/Branch');
    await Branch.updateOne(
      { _id: branch._id },
      {
        $set: {
          Slug: 'wiz-branch',
          CitySlug: 'hcm',
          DistrictSlug: 'q1',
          City: 'HCM',
          District: 'Q1',
        },
      }
    );

    const wiz = await request(app).get(`/booking/wizard?branchId=${branch._id}`);
    expect(wiz.status).toBe(200);
    expect(wiz.text).toContain('Price breakdown');
    expect(wiz.text).toContain('wz-addons');
    expect(wiz.text).toContain('booking-wizard.js');

    const page = await request(app).get('/khong-gian/hcm/q1/wiz-branch');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/Wifi|Whiteboard/);
    expect(page.text).toContain('Instant book');
    expect(page.text).toContain('Hủy miễn phí');
    expect(page.text).toContain('/booking/wizard');
  });

  test('create booking still returns priceBreakdown', async () => {
    const host = await createUser({ email: 'hpb@test.com', role: 'host' });
    const customer = await createUser({ email: 'cpb@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const day = new Date();
    day.setDate(day.getDate() + 5);
    day.setHours(0, 0, 0, 0);
    const { start, end } = absoluteRange(day, 14, 0, 15, 0);
    const { token } = agentWithAuth(app, customer);
    const csrf = await getCsrfPair(app);
    const res = await withCsrf(
      request(app).post('/api/customers/me/bookings'),
      csrf,
      `authToken=${token}`
    ).send({
      spaceId: space._id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      holdMinutes: 15,
    });
    expect(res.status).toBe(201);
    expect(res.body.priceBreakdown).toBeTruthy();
    expect(res.body.priceBreakdown.totalAmount).toBeGreaterThan(0);
    expect(res.body.priceBreakdown.depositAmount).toBeGreaterThan(0);
  });
});
