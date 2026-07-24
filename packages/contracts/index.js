"use strict";

const { z } = require("zod");

// 1. Standardized Event Envelope Schema
const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string(),
  occurredAt: z.string().datetime(),
  producer: z.string(),
  aggregateId: z.string(),
  aggregateVersion: z.number().int().nonnegative(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  traceId: z.string().optional(),
  data: z.record(z.any()),
});

// 2. Specific Domain Event Data Schemas
const ReviewCreatedEventDataSchema = z.object({
  reviewId: z.string(),
  spaceId: z.string(),
  rating: z.number().min(1).max(5),
});

const RatingRecalculatedEventDataSchema = z.object({
  spaceId: z.string(),
  ratingAvg: z.number().min(0).max(5),
});

const BookingHoldCreatedEventDataSchema = z.object({
  bookingId: z.string(),
  spaceId: z.string(),
  depositAmount: z.number().nonnegative(),
  expiresAt: z.string().datetime(),
});

const BookingConfirmedEventDataSchema = z.object({
  bookingId: z.string(),
  spaceId: z.string(),
  paidAmount: z.number().nonnegative(),
});

const PaymentSucceededEventDataSchema = z.object({
  bookingId: z.string(),
  amount: z.number().nonnegative(),
  paymentId: z.string(),
});

const RefundCompletedEventDataSchema = z.object({
  refundId: z.string(),
  bookingId: z.string(),
  refundAmount: z.number().nonnegative(),
});

// Helper validation function
function validateEvent(envelope) {
  const result = EventEnvelopeSchema.safeParse(envelope);
  if (!result.success) {
    throw new Error(`Invalid event envelope: ${result.error.message}`);
  }

  const { eventType, data } = envelope;
  let dataSchema;

  switch (eventType) {
    case "catalog.review-created.v1":
      dataSchema = ReviewCreatedEventDataSchema;
      break;
    case "catalog.rating-recalculated.v1":
      dataSchema = RatingRecalculatedEventDataSchema;
      break;
    case "booking.hold-created.v1":
      dataSchema = BookingHoldCreatedEventDataSchema;
      break;
    case "booking.confirmed.v1":
      dataSchema = BookingConfirmedEventDataSchema;
      break;
    case "billing.payment-succeeded.v1":
      dataSchema = PaymentSucceededEventDataSchema;
      break;
    case "billing.refund-completed.v1":
      dataSchema = RefundCompletedEventDataSchema;
      break;
    default:
      // Unknown event type: pass envelope validation but warn
      return envelope;
  }

  const dataResult = dataSchema.safeParse(data);
  if (!dataResult.success) {
    throw new Error(`Invalid event data for ${eventType}: ${dataResult.error.message}`);
  }

  return envelope;
}

module.exports = {
  EventEnvelopeSchema,
  ReviewCreatedEventDataSchema,
  RatingRecalculatedEventDataSchema,
  BookingHoldCreatedEventDataSchema,
  BookingConfirmedEventDataSchema,
  PaymentSucceededEventDataSchema,
  RefundCompletedEventDataSchema,
  validateEvent,
};
