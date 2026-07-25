'use strict';

const mongoose = require('mongoose');

const ROLES = ['owner', 'manager', 'receptionist', 'finance', 'content_editor', 'support'];

const staffMemberSchema = new mongoose.Schema(
  {
    HostOwnerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    Role: { type: String, enum: ROLES, required: true },
    BranchIDs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    /** true = all host branches; false + empty BranchIDs = deny all (no silent all-access) */
    AllBranches: { type: Boolean, default: false },
    Status: {
      type: String,
      enum: ['active', 'invited', 'revoked'],
      default: 'active',
      index: true,
    },
    InviteTokenHash: { type: String, default: null },
    InviteExpiresAt: { type: Date, default: null },
  },
  { collection: 'staff_members', timestamps: true }
);

staffMemberSchema.index({ HostOwnerID: 1, UserID: 1 }, { unique: true });

module.exports = mongoose.model('StaffMember', staffMemberSchema);
module.exports.ROLES = ROLES;
