'use strict';

const mongoose = require('mongoose');

const backgroundJobSchema = new mongoose.Schema(
  {
    Queue: { type: String, required: true, index: true },
    Type: {
      type: String,
      required: true,
      enum: ['email', 'export_ledger', 'export_bookings', 'booking_reminder', 'generic'],
      index: true,
    },
    Payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    Status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    Attempts: { type: Number, default: 0 },
    MaxAttempts: { type: Number, default: 3 },
    Result: { type: mongoose.Schema.Types.Mixed, default: null },
    Error: { type: String, default: '' },
    OwnerUserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    RunAfter: { type: Date, default: Date.now, index: true },
    CompletedAt: { type: Date, default: null },
  },
  { collection: 'background_jobs', timestamps: true }
);

backgroundJobSchema.index({ Status: 1, RunAfter: 1, createdAt: 1 });

module.exports = mongoose.model('BackgroundJob', backgroundJobSchema);
