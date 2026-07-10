'use strict';
const mongoose = require('mongoose');

const recurringSeriesSchema = new mongoose.Schema(
  {
    CustomerID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    SpaceID: { type: mongoose.Schema.Types.ObjectId, ref: 'Space', required: true },
    HostID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    Frequency: { type: String, enum: ['daily', 'weekly'], required: true },
    Interval: { type: Number, default: 1, min: 1 },
    DaysOfWeek: [{ type: Number, min: 0, max: 6 }],
    StartTimeOfDay: { type: String, required: true }, // HH:mm
    DurationMinutes: { type: Number, required: true, min: 30 },
    SeriesStart: { type: Date, required: true },
    SeriesEnd: { type: Date, default: null },
    OccurrenceCount: { type: Number, default: null },
    Status: { type: String, enum: ['active', 'paused', 'cancelled'], default: 'active' },
    BookingIDs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],
    IdempotencyKey: { type: String, sparse: true, unique: true },
    Timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
  },
  { collection: 'recurring_series', timestamps: true }
);

module.exports = mongoose.model('RecurringSeries', recurringSeriesSchema);
