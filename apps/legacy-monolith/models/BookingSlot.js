'use strict';

const mongoose = require('mongoose');

/**
 * Discrete time slots for a space. Unique index prevents double-booking race.
 */
const bookingSlotSchema = new mongoose.Schema(
  {
    SpaceID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Space',
      required: true,
      index: true,
    },
    BookingID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    SlotStart: {
      type: Date,
      required: true,
    },
  },
  {
    collection: 'booking_slots',
    timestamps: true,
  }
);

bookingSlotSchema.index({ SpaceID: 1, SlotStart: 1 }, { unique: true });

module.exports = mongoose.model('BookingSlot', bookingSlotSchema);
