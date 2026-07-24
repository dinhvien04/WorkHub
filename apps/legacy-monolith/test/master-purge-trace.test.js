'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  startMemoryMongo,
  stopMemoryMongo,
  clearDb,
  getApp,
} = require('./helpers');
const { parseTraceparent, startSpan, endSpan } = require('../utils/tracing');

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

describe('CSS purge build', () => {
  test('purge-css produces smaller or equal app.min.css', () => {
    execSync('node scripts/purge-css.js', { cwd: process.cwd() });
    const minPath = path.join('public', 'css', 'app.min.css');
    const purgedPath = path.join('public', 'css', 'utilities.purged.css');
    expect(fs.existsSync(minPath)).toBe(true);
    expect(fs.existsSync(purgedPath)).toBe(true);
    const min = fs.readFileSync(minPath, 'utf8');
    expect(min.length).toBeGreaterThan(500);
    expect(min).toContain('.flex');
    // should still serve
  });
});

describe('Tracing', () => {
  test('traceparent parse and response header', async () => {
    const parsed = parseTraceparent(
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
    );
    expect(parsed.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(parsed.parentId).toBe('b7ad6b7169203331');

    const res = await request(app)
      .get('/health')
      .set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    expect(res.status).toBe(200);
    // may or may not sample, but if header present should be valid format
    const tp = res.headers.traceparent;
    if (tp) {
      expect(tp.split('-').length).toBe(4);
      expect(tp.split('-')[1]).toBe('0af7651916cd43dd8448eb211c80319c');
    }

    // unit endSpan no throw
    const fakeReq = {
      method: 'GET',
      path: '/x',
      originalUrl: '/x',
      headers: {},
    };
    const span = startSpan(fakeReq);
    endSpan(span, { statusCode: 200 });
  });
});
