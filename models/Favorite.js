'use strict';

const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    BranchID: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    Note: { type: String, default: '', maxlength: 200 },
  },
  { collection: 'favorites', timestamps: true }
);

favoriteSchema.index({ UserID: 1, BranchID: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
