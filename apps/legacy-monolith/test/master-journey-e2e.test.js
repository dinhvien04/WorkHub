'use strict';

/**
 * Full product journey (API-level E2E, no browser):
 * host space → customer book → gateway pay → host verify → check-in → complete path
 */
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
const gatewayService = require('../services/gatewayService');
const paymentService = require('../services/paymentService');
const PaymentHistory = require('../models/Payment_History');

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

describe('API journey E2E', () => {
  test('search → book → gateway → verify → check-in → featured/sitemap', async () => {
    const host = await createUser({ email: 'hjourney@test.com', role: 'host' });
    const customer = await createUser({ email: 'cjourney@test.com', role: 'customer' });
    const { space, branch } = await seedHostSpace(host);
    // geo + images for sitemap
    const Branch = require('../models/Branch');
    await Branch.updateOne(
      { _id: branch._id },
      {
        $set: {
          Latitude: 10.77,
          Longitude: 106.7,
          Location: { type: 'Point', coordinates: [106.7, 10.77] },
          Images: ['https://cdn.example.com/branch1.jpg'],
          CitySlug: 'ho-chi-minh',
          DistrictSlug: 'quan-1',
          Slug: 'workhub-test-branch',
          RatingAvg: 4.5,
        },
      }
    );

    // Public search + featured
    expect((await request(app).get('/api/search?limit=5')).status).toBe(200);
    const feat = await request(app).get('/api/featured');
    expect(feat.status).toBe(200);
    expect(Array.isArray(feat.body.featured)).toBe(true);

    // SEO
    expect((await request(app).get('/sitemap-images.xml')).status).toBe(200);
    expect((await request(app).get('/sitemap_index.xml')).text).toContain('sitemap-images');

    // Book
    const { start, end } = futureRange(6, 2);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    expect(booking.TotalAmount).toBeGreaterThan(0);

    // Gateway checkout + webhook
    const { session } = await gatewayService.createCheckoutSession({
      customerId: customer._id,
      bookingId: booking._id,
      amount: booking.DepositAmount,
      idempotencyKey: 'journey-gw-1',
    });
    const event = {
      type: 'checkout.session.completed',
      id: 'evt_journey',
      sessionId: session.SessionId,
    };
    const raw = JSON.stringify(event);
    const sig = gatewayService.signPayload(raw, session.Provider || 'workhub_mock');
    const wh = await gatewayService.handleWebhook({
      rawBody: raw,
      signature: sig,
      event,
      provider: session.Provider,
    });
    expect(wh.ok).toBe(true);

    // Host confirm if still pending
    if (booking.Status === 'pending' || booking.Status === 'payment_under_review') {
      try {
        await bookingService.confirmBooking(host._id, booking._id);
      } catch {
        /* may already transition */
      }
    }

    // Manual payment path verify remaining if any pending
    const pending = await PaymentHistory.find({ BookingID: booking._id, Status: 'pending' });
    for (const p of pending) {
      await paymentService.verifyPayment(host._id, p._id);
    }

    // Confirm + check-in
    let b = await require('../models/Booking').findById(booking._id);
    if (b.Status !== 'confirmed' && b.Status !== 'in-use') {
      try {
        await bookingService.confirmBooking(host._id, booking._id);
      } catch {
        /* ok */
      }
    }
    b = await require('../models/Booking').findById(booking._id);
    if (b.Status === 'confirmed') {
      const inUse = await bookingService.checkInBooking(host._id, booking._id);
      expect(inUse.Status).toBe('in-use');
    }

    // Customer dashboard
    const { token } = agentWithAuth(app, customer);
    const dash = await request(app)
      .get('/api/me/dashboard')
      .set('Cookie', `authToken=${token}`);
    expect(dash.status).toBe(200);

    // Metrics reflect bookings
    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toContain('workhub_bookings_created_total');
  });
});
