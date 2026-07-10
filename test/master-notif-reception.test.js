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
  futureRange,
} = require('./helpers');
const bookingService = require('../services/bookingService');
const { notifyUser } = require('../services/notificationService');
const fs = require('fs');
const path = require('path');

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

describe('Notifications filter + delete + unread-count', () => {
  test('list filter type, mark read, delete, unread-count', async () => {
    const user = await createUser({ email: 'nuser@test.com', role: 'customer' });
    await notifyUser({
      userId: user._id,
      title: 'Booking OK',
      body: 'confirmed',
      type: 'booking',
      link: '/dashboard',
    });
    await notifyUser({
      userId: user._id,
      title: 'Pay',
      body: 'pending',
      type: 'payment',
    });
    await notifyUser({
      userId: user._id,
      title: 'Sys',
      body: 'hello',
      type: 'system',
    });

    const { token } = agentWithAuth(app, user);
    const all = await request(app)
      .get('/api/me/notifications?limit=20')
      .set('Cookie', `authToken=${token}`);
    expect(all.status).toBe(200);
    expect(all.body.notifications.length).toBe(3);
    expect(all.body.unreadCount).toBe(3);

    const bookingOnly = await request(app)
      .get('/api/me/notifications?type=booking')
      .set('Cookie', `authToken=${token}`);
    expect(bookingOnly.body.notifications.length).toBe(1);
    expect(bookingOnly.body.notifications[0].Type).toBe('booking');

    const count = await request(app)
      .get('/api/me/notifications/unread-count')
      .set('Cookie', `authToken=${token}`);
    expect(count.status).toBe(200);
    expect(count.body.unreadCount).toBe(3);

    const id = all.body.notifications[0]._id;
    const csrf = await getCsrfPair(app);
    const read = await withCsrf(
      request(app).patch(`/api/me/notifications/${id}/read`),
      csrf,
      `authToken=${token}`
    );
    expect(read.status).toBe(200);

    const after = await request(app)
      .get('/api/me/notifications/unread-count')
      .set('Cookie', `authToken=${token}`);
    expect(after.body.unreadCount).toBe(2);

    const del = await withCsrf(
      request(app).delete(`/api/me/notifications/${id}`),
      csrf,
      `authToken=${token}`
    );
    expect(del.status).toBe(200);

    const left = await request(app)
      .get('/api/me/notifications')
      .set('Cookie', `authToken=${token}`);
    expect(left.body.notifications.length).toBe(2);
  });
});

describe('Host reception scan by code', () => {
  test('scan WH- code check-in', async () => {
    const host = await createUser({ email: 'hrx@test.com', role: 'host' });
    const customer = await createUser({ email: 'crx@test.com', role: 'customer' });
    const { space } = await seedHostSpace(host);
    const { start, end } = futureRange(1, 2);
    const booking = await bookingService.createBooking({
      customerId: customer._id,
      spaceId: space._id,
      startTime: start,
      endTime: end,
    });
    await bookingService.confirmBooking(host._id, booking._id);

    // Align window so check-in early/late policy allows (start ~now)
    await require('../models/Booking').updateOne(
      { _id: booking._id },
      {
        $set: {
          StartTime: new Date(Date.now() - 5 * 60000),
          EndTime: new Date(Date.now() + 55 * 60000),
        },
      }
    );

    const checkInService = require('../services/checkInService');
    const minted = await checkInService.mintCheckInToken({
      bookingId: booking._id,
      actorId: host._id,
      actorRole: 'host',
    });
    const code = minted.code;
    const { token } = agentWithAuth(app, host);
    const csrf = await getCsrfPair(app);
    const scan = await withCsrf(
      request(app).post('/api/host/check-in/scan'),
      csrf,
      `authToken=${token}`
    ).send({ code });
    expect(scan.status).toBe(200);
    expect(scan.body.message).toMatch(/Check-in/i);

    const today = await request(app)
      .get('/api/host/reception/today')
      .set('Cookie', `authToken=${token}`);
    expect(today.status).toBe(200);
    expect(Array.isArray(today.body.bookings)).toBe(true);
  });
});

describe('UI assets', () => {
  test('notifications filters and reception markup', async () => {
    const notifPage = await request(app).get('/notifications');
    expect(notifPage.status).toBe(200);
    expect(notifPage.text).toContain('notif-filters');
    expect(notifPage.text).toContain('header-notif-badge');

    const rxJs = fs.readFileSync(path.join(__dirname, '../public/js/host-reception.js'), 'utf8');
    expect(rxJs).toContain('no-show');
    expect(rxJs).toContain('rx-paste');
    expect(rxJs).toContain('WH-');
  });
});
