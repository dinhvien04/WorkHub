'use strict';
const mongoose = require('mongoose');

const deadLetterSchema = new mongoose.Schema(
  {
    Queue: { type: String, required: true, index: true },
    Payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    Error: { type: String, default: '' },
    Attempts: { type: Number, default: 0 },
    Status: { type: String, enum: ['open', 'replayed', 'discarded'], default: 'open', index: true },
  },
  { collection: 'dead_letters', timestamps: true }
);

module.exports = mongoose.model('DeadLetter', deadLetterSchema);
