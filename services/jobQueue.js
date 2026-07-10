'use strict';

const fs = require('fs');
const path = require('path');
const DeadLetter = require('../models/DeadLetter');
const BackgroundJob = require('../models/BackgroundJob');
const logger = require('../utils/logger');

/**
 * Durable job queue (Mongo) with retry + dead letter.
 * Optional Redis list is not required — multi-instance safe via findOneAndUpdate claim.
 */

const handlers = new Map();

function registerHandler(type, fn) {
  handlers.set(type, fn);
}

async function withRetry(fn, { queue = 'default', payload = {}, maxAttempts = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const delay = Math.min(2000, 100 * 2 ** attempt) + Math.floor(Math.random() * 50);
      logger.warn(`Queue ${queue} attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  await DeadLetter.create({
    Queue: queue,
    Payload: payload,
    Error: lastErr?.message || 'unknown',
    Attempts: maxAttempts,
    Status: 'open',
  });
  throw lastErr;
}

async function enqueue({
  type = 'generic',
  queue = 'default',
  payload = {},
  ownerUserId = null,
  maxAttempts = 3,
  runAfter = null,
}) {
  const job = await BackgroundJob.create({
    Queue: queue,
    Type: type,
    Payload: payload,
    OwnerUserID: ownerUserId,
    MaxAttempts: maxAttempts,
    Status: 'queued',
    RunAfter: runAfter ? new Date(runAfter) : new Date(),
  });
  return job;
}

async function getJob(jobId) {
  return BackgroundJob.findById(jobId).lean();
}

async function listJobsForUser(userId, { limit = 20 } = {}) {
  return BackgroundJob.find({ OwnerUserID: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Claim and process next queued job (atomic).
 */
async function processNextJob() {
  const now = new Date();
  const job = await BackgroundJob.findOneAndUpdate(
    {
      Status: 'queued',
      RunAfter: { $lte: now },
      Attempts: { $lt: 10 },
    },
    {
      $set: { Status: 'running' },
      $inc: { Attempts: 1 },
    },
    { sort: { RunAfter: 1, createdAt: 1 }, returnDocument: 'after' }
  );
  if (!job) return null;

  const handler = handlers.get(job.Type);
  try {
    if (!handler) {
      throw new Error(`No handler for job type ${job.Type}`);
    }
    const result = await withRetry(() => handler(job.Payload, job), {
      queue: job.Queue,
      payload: { jobId: job._id, type: job.Type, ...job.Payload },
      maxAttempts: Math.min(job.MaxAttempts || 3, 3),
    });
    job.Status = 'completed';
    job.Result = result || { ok: true };
    job.CompletedAt = new Date();
    job.Error = '';
    await job.save();
    return job;
  } catch (err) {
    job.Status = 'failed';
    job.Error = err.message || 'failed';
    await job.save();
    return job;
  }
}

async function processBatch({ limit = 5 } = {}) {
  const done = [];
  for (let i = 0; i < limit; i++) {
    const j = await processNextJob();
    if (!j) break;
    done.push(j);
  }
  return done;
}

async function listDeadLetters({ limit = 50 } = {}) {
  return DeadLetter.find({ Status: 'open' }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function discardDeadLetter(id) {
  return DeadLetter.findByIdAndUpdate(id, { $set: { Status: 'discarded' } }, { new: true });
}

/**
 * Re-queue a failed job or re-enqueue payload from a dead letter.
 */
async function replayDeadLetter(id) {
  const dl = await DeadLetter.findById(id);
  if (!dl) {
    const err = new Error('Dead letter not found');
    err.statusCode = 404;
    throw err;
  }
  const payload = dl.Payload || {};
  const type = payload.type || 'generic';
  const job = await enqueue({
    type,
    queue: dl.Queue || 'default',
    payload: payload.payload || payload,
    ownerUserId: payload.ownerUserId || null,
    maxAttempts: 3,
  });
  dl.Status = 'replayed';
  await dl.save();
  return { deadLetter: dl, job };
}

async function retryFailedJob(jobId) {
  const job = await BackgroundJob.findById(jobId);
  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }
  if (job.Status !== 'failed' && job.Status !== 'completed') {
    const err = new Error('Chỉ retry job failed/completed.');
    err.statusCode = 400;
    throw err;
  }
  job.Status = 'queued';
  job.Error = '';
  job.RunAfter = new Date();
  job.CompletedAt = null;
  await job.save();
  return job;
}

// —— Built-in handlers ——
registerHandler('email', async (payload) => {
  const emailService = require('./emailService');
  await emailService.sendGeneric({
    to: payload.to,
    subject: payload.subject || 'WorkHub',
    text: payload.text || payload.body || '',
  });
  return { sent: true, to: payload.to };
});

registerHandler('export_ledger', async (payload, job) => {
  const ledgerService = require('./ledgerService');
  const exportService = require('./exportService');
  const hostId = payload.hostId || job.OwnerUserID;
  const data = await ledgerService.listLedger(hostId, { page: 1, limit: 2000 });
  const csv = exportService.ledgerToCsv(data.items);
  const dir = path.join(process.cwd(), 'tmp', 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ledger-${hostId}-${Date.now()}.csv`);
  fs.writeFileSync(file, csv, 'utf8');
  return { file: path.relative(process.cwd(), file), rows: data.items.length };
});

registerHandler('export_bookings', async (payload, job) => {
  const Booking = require('../models/Booking');
  const hostId = payload.hostId || job.OwnerUserID;
  const items = await Booking.find({ HostID: hostId })
    .sort({ createdAt: -1 })
    .limit(2000)
    .lean();
  const header = 'id,status,start,end,total,customer\n';
  const rows = items
    .map(
      (b) =>
        [
          b._id,
          b.Status,
          b.StartTime?.toISOString?.() || b.StartTime,
          b.EndTime?.toISOString?.() || b.EndTime,
          b.TotalAmount,
          b.CustomerID,
        ].join(',')
    )
    .join('\n');
  const dir = path.join(process.cwd(), 'tmp', 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bookings-${hostId}-${Date.now()}.csv`);
  fs.writeFileSync(file, header + rows + '\n', 'utf8');
  return { file: path.relative(process.cwd(), file), rows: items.length };
});

registerHandler('booking_reminder', async (payload) => {
  const { notifyUser } = require('./notificationService');
  await notifyUser({
    userId: payload.userId,
    title: payload.title || 'Nhắc lịch booking',
    body: payload.body || '',
    type: 'booking',
    entityType: 'Booking',
    entityId: payload.bookingId,
    link: payload.link || '/history',
  });
  try {
    const pushService = require('./pushService');
    await pushService.notifyPush(payload.userId, {
      title: payload.title || 'Nhắc lịch booking',
      body: payload.body || '',
      url: payload.link || '/history',
    });
  } catch {
    /* optional */
  }
  return { notified: true };
});

registerHandler('generic', async (payload) => payload);

module.exports = {
  withRetry,
  listDeadLetters,
  discardDeadLetter,
  replayDeadLetter,
  retryFailedJob,
  enqueue,
  getJob,
  listJobsForUser,
  processNextJob,
  processBatch,
  registerHandler,
};
