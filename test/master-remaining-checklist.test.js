'use strict';

const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  createUser,
  getApp,
  agentWithAuth,
} = require('./helpers');
const money = require('../utils/money');
const logActivity = require('../utils/auditLogger');
const calendarService = require('../services/calendarService');
const funnelService = require('../services/funnelService');
const alertService = require('../services/alertService');
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

describe('Money integer minor units', () => {
  test('toMinor rejects float VND', () => {
    expect(money.toMinor(1000)).toBe(1000);
    expect(() => money.toMinor(10.5)).toThrow(/integer/i);
    expect(money.moneyDto(25000).currency).toBe('VND');
  });
});

describe('Audit redaction', () => {
  test('redactObject hides secrets', () => {
    const r = logActivity.redactObject({
      password: 'secret',
      bankNumber: '123456',
      ok: 'visible',
    });
    expect(r.password).toBe('[REDACTED]');
    expect(r.bankNumber).toBe('[REDACTED]');
    expect(r.ok).toBe('visible');
  });
});

describe('Calendar external links P2', () => {
  test('deep links include google microsoft ics', () => {
    const booking = {
      _id: '507f1f77bcf86cd799439011',
      StartTime: new Date('2030-01-01T10:00:00Z'),
      EndTime: new Date('2030-01-01T12:00:00Z'),
      Snapshot: { SpaceName: 'Room A', Address: 'HCMC' },
    };
    const links = calendarService.calendarDeepLinks(booking);
    expect(links.google).toMatch(/google\.com\/calendar/);
    expect(links.microsoft || links.outlook).toMatch(/outlook/);
    expect(links.icsPath).toMatch(/\/ics$/);
    const feed = calendarService.hostFeedIcs(
      [{ id: '1', start: booking.StartTime, end: booking.EndTime, title: 'T' }],
      'host1'
    );
    expect(feed).toMatch(/BEGIN:VCALENDAR/);
  });
});

describe('Funnel + alerts', () => {
  test('funnel track and report', async () => {
    funnelService.track('landing');
    funnelService.track('search');
    const snap = funnelService.snapshotProcess();
    expect(snap.landing).toBeGreaterThanOrEqual(1);
    const report = await funnelService.funnelReport({ days: 7 });
    expect(report.path).toContain('booking');
    expect(report.conversion).toBeDefined();
  });

  test('alert service records events', async () => {
    await alertService.sendAlert({
      code: 'TEST_ALERT',
      message: 'hello',
      level: 'info',
    });
    const list = alertService.listRecent(5);
    expect(list[0].code).toBe('TEST_ALERT');
  });
});

describe('Admin funnel/recon endpoints', () => {
  test('conversion metrics and recon export', async () => {
    const admin = await createUser({ email: 'adm@test.com', role: 'admin' });
    const { token } = agentWithAuth(app, admin);
    const conv = await request(app)
      .get('/api/admin/metrics/conversion')
      .set('Cookie', `authToken=${token}`);
    expect(conv.status).toBe(200);
    expect(conv.body.funnel).toBeDefined();

    const recon = await request(app)
      .get('/api/admin/finance/recon-export')
      .set('Cookie', `authToken=${token}`);
    expect(recon.status).toBe(200);
    expect(Array.isArray(recon.body.payments)).toBe(true);
  });
});
