'use strict';

const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ObjectId không hợp lệ');

const pagination = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const bookingCreate = z.object({
  spaceId: objectId,
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  note: z.string().max(500).optional(),
  couponCode: z.string().max(40).optional(),
  holdMinutes: z.coerce.number().int().min(5).max(60).optional(),
  addOnIds: z.array(objectId).max(20).optional(),
});

const reschedule = z.object({
  startTime: z.string().min(1),
  endTime: z.string().min(1),
});

const refundRequest = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().max(1000).optional(),
});

const staffInvite = z.object({
  email: z.string().email(),
  role: z.enum(['manager', 'receptionist', 'finance', 'content_editor', 'support']),
  branchIds: z.array(objectId).optional(),
});

const disputeOpen = z.object({
  reason: z.string().min(5).max(2000),
});

const supportTicket = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(5).max(5000),
  bookingId: objectId.optional(),
});

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => i.message).join('; ');
    const err = new Error(msg || 'Validation error');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.isOperational = true;
    err.details = r.error.issues;
    throw err;
  }
  return r.data;
}

module.exports = {
  objectId,
  pagination,
  bookingCreate,
  reschedule,
  refundRequest,
  staffInvite,
  disputeOpen,
  supportTicket,
  parse,
};
