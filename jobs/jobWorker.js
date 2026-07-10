'use strict';

const jobQueue = require('../services/jobQueue');
const logger = require('../utils/logger');

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const done = await jobQueue.processBatch({ limit: 5 });
    if (done.length) {
      logger.info(`Job worker processed ${done.length} job(s)`);
    }
  } catch (err) {
    logger.error(`Job worker error: ${err.message}`);
  } finally {
    running = false;
  }
}

function startJobWorker(intervalMs = 15_000) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  logger.info(`Background job worker every ${intervalMs}ms`);
  // first run soon
  setTimeout(tick, 2000).unref?.();
}

function stopJobWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startJobWorker, stopJobWorker, tick };
