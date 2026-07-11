'use strict';

process.env.NODE_ENV = 'test';
process.env.ENABLE_TRANSACTIONS = 'true';
process.env.ALLOW_MOCK_PAYMENT_PROVIDER = '1';
process.env.ALLOW_MOCK_COMPLETE = '1';
process.env.PAYMENT_PROVIDER = 'workhub_mock';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test_jwt_secret_key_at_least_32_characters_long_for_workhub';
process.env.GATEWAY_WEBHOOK_SECRET =
  process.env.GATEWAY_WEBHOOK_SECRET ||
  'whsec_test_secret_at_least_32_chars_long';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.setTimeout(180000);

let replset;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replset.getUri());
  await mongoose.connection.db.admin().command({ ping: 1 });
  const env = require('../config/env');
  env.ENABLE_TRANSACTIONS = true;
  env.ALLOW_MOCK_PAYMENT_PROVIDER = true;
  env.ALLOW_MOCK_COMPLETE = true;
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

describe('webhook-transactions', () => {
  test('checkout idempotency is tenant-scoped; B never sees A session', async () => {
    const User = require('../models/User');
    const Booking = require('../models/Booking');
    const gatewayService = require('../services/gatewayService');

    const host = await User.create({
      Email: `h-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'H',
      Role: 'host',
      Status: 'active',
      EmailVerified: true,
    });
    const custA = await User.create({
      Email: `a-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'A',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });
    const custB = await User.create({
      Email: `b-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'B',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });

    const bookingA = await Booking.create({
      CustomerID: custA._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: 'pending',
    });
    const bookingB = await Booking.create({
      CustomerID: custB._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: 'pending',
    });

    const sameKey = 'same-client-key';
    const resA = await gatewayService.createCheckoutSession({
      customerId: custA._id,
      bookingId: bookingA._id,
      paymentType: 'deposit',
      idempotencyKey: sameKey,
    });
    const resB = await gatewayService.createCheckoutSession({
      customerId: custB._id,
      bookingId: bookingB._id,
      paymentType: 'deposit',
      idempotencyKey: sameKey,
    });

    expect(String(resA.session.CustomerID)).toBe(String(custA._id));
    expect(String(resB.session.CustomerID)).toBe(String(custB._id));
    expect(resA.session.SessionId).not.toBe(resB.session.SessionId);
  });

  test('same key different payment type returns 409', async () => {
    const User = require('../models/User');
    const Booking = require('../models/Booking');
    const gatewayService = require('../services/gatewayService');

    const host = await User.create({
      Email: `h2-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'H2',
      Role: 'host',
      Status: 'active',
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `c2-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'C2',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });
    const b1 = await Booking.create({
      CustomerID: cust._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: 'pending',
    });

    await gatewayService.createCheckoutSession({
      customerId: cust._id,
      bookingId: b1._id,
      paymentType: 'deposit',
      idempotencyKey: 'key-fp-test',
    });

    await expect(
      gatewayService.createCheckoutSession({
        customerId: cust._id,
        bookingId: b1._id,
        paymentType: 'full_payment',
        idempotencyKey: 'key-fp-test',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('webhook settlement is transactional: payment + ledger + processed + outbox', async () => {
    const User = require('../models/User');
    const Booking = require('../models/Booking');
    const PaymentHistory = require('../models/Payment_History');
    const LedgerEntry = require('../models/LedgerEntry');
    const WebhookEvent = require('../models/WebhookEvent');
    const OutboxEvent = require('../models/OutboxEvent');
    const gatewayService = require('../services/gatewayService');
    const env = require('../config/env');
    env.ENABLE_TRANSACTIONS = true;
    env.ALLOW_MOCK_COMPLETE = true;

    const host = await User.create({
      Email: `h3-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'H3',
      Role: 'host',
      Status: 'active',
      EmailVerified: true,
    });
    const cust = await User.create({
      Email: `c3-wh-${Date.now()}@t.local`,
      PasswordHash: 'x'.repeat(60),
      FullName: 'C3',
      Role: 'customer',
      Status: 'active',
      EmailVerified: true,
    });
    const booking = await Booking.create({
      CustomerID: cust._id,
      HostID: host._id,
      SpaceID: new mongoose.Types.ObjectId(),
      StartTime: new Date(Date.now() + 86400000),
      EndTime: new Date(Date.now() + 90000000),
      TotalAmount: 100000,
      DepositAmount: 30000,
      Status: 'pending',
    });

    const { session } = await gatewayService.createCheckoutSession({
      customerId: cust._id,
      bookingId: booking._id,
      paymentType: 'deposit',
      idempotencyKey: `wh-settle-${booking._id}`,
    });

    const result = await gatewayService.mockCompleteSession(
      session.SessionId,
      cust._id
    );
    expect(result.ok).toBe(true);

    const payments = await PaymentHistory.find({
      TransactionCode: `GW-${session.SessionId}`,
    });
    expect(payments.length).toBe(1);
    expect(payments[0].PaymentType).toBe('deposit');

    const ledger = await LedgerEntry.find({
      IdempotencyKey: `payment:gw-${session.SessionId}:credit`,
    });
    expect(ledger.length).toBe(1);

    const events = await WebhookEvent.find({ ProcessingStatus: 'processed' });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const outbox = await OutboxEvent.find({
      IdempotencyKey: `booking:gw-${session.SessionId}:notify-host`,
    });
    expect(outbox.length).toBe(1);

    const again = await gatewayService.mockCompleteSession(
      session.SessionId,
      cust._id
    );
    expect(again.duplicate || again.ok).toBeTruthy();
    expect(
      await PaymentHistory.countDocuments({
        TransactionCode: `GW-${session.SessionId}`,
      })
    ).toBe(1);
  });

  test('live Stripe verification uses official SDK — mock HMAC cannot auth stripe', async () => {
    const providers = require('../services/gatewayProviders');
    const raw = JSON.stringify({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_x', amount_total: 1000 } },
    });
    const mockSig = providers.signForProvider('workhub_mock', raw);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(providers.verifyForProvider('stripe', raw, mockSig)).toBe(false);
  });

  test('markWebhookProcessed requires ProcessingBy ownership', async () => {
    const WebhookEvent = require('../models/WebhookEvent');
    const gatewayService = require('../services/gatewayService');

    const ev = await WebhookEvent.create({
      Provider: 'workhub_mock',
      ProviderEventID: `evt-lease-${Date.now()}`,
      PayloadHash: 'abc',
      ProcessingStatus: 'processing',
      ProcessingBy: 'worker-A',
      ProcessingLeaseUntil: new Date(Date.now() + 60000),
      Attempts: 1,
    });

    await expect(
      gatewayService.markWebhookProcessed(ev._id, 'worker-B')
    ).rejects.toMatchObject({ code: 'WEBHOOK_LEASE_LOST' });

    const ok = await gatewayService.markWebhookProcessed(ev._id, 'worker-A');
    expect(ok.ProcessingStatus).toBe('processed');
  });
});
