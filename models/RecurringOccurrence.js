'use strict';

const mongoose = require('mongoose');

const recurringOccurrenceSchema = new mongoose.Schema(
  {
    SeriesID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecurringSeries',
      required: true,
      index: true,
    },
    OccurrenceKey: { type: String, required: true },
    StartTime: { type: Date, required: true },
    EndTime: { type: Date, required: true },
    Status: {
      type: String,
      enum: ['pending', 'created', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    Attempts: { type: Number, default: 0 },
    FailureCode: { type: String, default: '' },
  },
  { collection: 'recurring_occurrences', timestamps: true }
);

recurringOccurrenceSchema.index(
  { SeriesID: 1, OccurrenceKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('RecurringOccurrence', recurringOccurrenceSchema);
