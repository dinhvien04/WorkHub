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

const ReviewRepliedEventDataSchema = z.object({
  reviewId: z.string(),
  spaceId: z.string(),
  customerId: z.string(),
  hostId: z.string(),
  replyText: z.string().max(2000),
  repliedAt: z.string().datetime(),
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
  customerId: z.string(),
  hostId: z.string(),
  paidAmount: z.number().nonnegative(),
  spaceName: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

const BookingCancelledEventDataSchema = z.object({
  bookingId: z.string(),
  spaceId: z.string(),
  customerId: z.string(),
  hostId: z.string(),
  spaceName: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  reason: z.string().max(500).optional(),
  cancelledBy: z.enum(["host", "customer"]),
});

const PaymentSucceededEventDataSchema = z.object({
  bookingId: z.string(),
  amount: z.number().nonnegative(),
  paymentId: z.string(),
  customerId: z.string(),
  hostId: z.string(),
});

const RefundCompletedEventDataSchema = z.object({
  refundId: z.string(),
  bookingId: z.string(),
  refundAmount: z.number().nonnegative(),
  customerId: z.string(),
  hostId: z.string(),
});

const UserCreatedEventDataSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  role: z.enum(["customer", "host", "admin"]),
  status: z.enum(["active", "inactive", "banned"]),
  tokenVersion: z.number().int().nonnegative(),
});

const UserUpdatedEventDataSchema = z.object({
  userId: z.string(),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
  role: z.enum(["customer", "host", "admin"]).optional(),
  status: z.enum(["active", "inactive", "banned"]).optional(),
  tokenVersion: z.number().int().nonnegative().optional(),
});

const UserStatusChangedEventDataSchema = z.object({
  userId: z.string(),
  status: z.enum(["active", "inactive", "banned"]),
});

const RoleChangedEventDataSchema = z.object({
  userId: z.string(),
  role: z.enum(["customer", "host", "admin"]),
});

const EmailVerifiedEventDataSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  verifiedAt: z.string().datetime(),
});

const PasswordChangedEventDataSchema = z.object({
  userId: z.string(),
  changedAt: z.string().datetime(),
});

const MfaChangedEventDataSchema = z.object({
  userId: z.string(),
  mfaEnabled: z.boolean(),
  mfaType: z.string(),
});

const SessionCreatedEventDataSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  publicSessionId: z.string(),
  authMethod: z.string(),
  expiresAt: z.string().datetime(),
});

const SessionRevokedEventDataSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  publicSessionId: z.string(),
  revokedAt: z.string().datetime(),
});

const AllSessionsRevokedEventDataSchema = z.object({
  userId: z.string(),
  revokedAt: z.string().datetime(),
  tokenVersion: z.number().int().nonnegative(),
});

// Content Domain Events (M5)
const PagePublishedEventDataSchema = z.object({
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  publishedAt: z.string().datetime(),
});

const PageUnpublishedEventDataSchema = z.object({
  slug: z.string(),
  type: z.string(),
});

const SeoRedirectUpdatedEventDataSchema = z.object({
  fromPath: z.string(),
  toPath: z.string(),
  statusCode: z.number().int(),
  active: z.boolean(),
});

const TranslationUpdatedEventDataSchema = z.object({
  locale: z.string(),
  key: z.string(),
  value: z.string(),
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
    case "catalog.review-replied.v1":
      dataSchema = ReviewRepliedEventDataSchema;
      break;
    case "booking.hold-created.v1":
      dataSchema = BookingHoldCreatedEventDataSchema;
      break;
    case "booking.confirmed.v1":
      dataSchema = BookingConfirmedEventDataSchema;
      break;
    case "booking.cancelled.v1":
      dataSchema = BookingCancelledEventDataSchema;
      break;
    case "billing.payment-succeeded.v1":
      dataSchema = PaymentSucceededEventDataSchema;
      break;
    case "billing.refund-completed.v1":
      dataSchema = RefundCompletedEventDataSchema;
      break;
    case "identity.user-created.v1":
      dataSchema = UserCreatedEventDataSchema;
      break;
    case "identity.user-updated.v1":
      dataSchema = UserUpdatedEventDataSchema;
      break;
    case "identity.user-status-changed.v1":
      dataSchema = UserStatusChangedEventDataSchema;
      break;
    case "identity.role-changed.v1":
      dataSchema = RoleChangedEventDataSchema;
      break;
    case "identity.email-verified.v1":
      dataSchema = EmailVerifiedEventDataSchema;
      break;
    case "identity.password-changed.v1":
      dataSchema = PasswordChangedEventDataSchema;
      break;
    case "identity.mfa-changed.v1":
      dataSchema = MfaChangedEventDataSchema;
      break;
    case "identity.session-created.v1":
      dataSchema = SessionCreatedEventDataSchema;
      break;
    case "identity.session-revoked.v1":
      dataSchema = SessionRevokedEventDataSchema;
      break;
    case "identity.all-sessions-revoked.v1":
      dataSchema = AllSessionsRevokedEventDataSchema;
      break;
    case "content.page-published.v1":
      dataSchema = PagePublishedEventDataSchema;
      break;
    case "content.page-unpublished.v1":
      dataSchema = PageUnpublishedEventDataSchema;
      break;
    case "content.seo-redirect-updated.v1":
      dataSchema = SeoRedirectUpdatedEventDataSchema;
      break;
    case "content.translation-updated.v1":
      dataSchema = TranslationUpdatedEventDataSchema;
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
  ReviewRepliedEventDataSchema,
  BookingHoldCreatedEventDataSchema,
  BookingConfirmedEventDataSchema,
  BookingCancelledEventDataSchema,
  PaymentSucceededEventDataSchema,
  RefundCompletedEventDataSchema,
  UserCreatedEventDataSchema,
  UserUpdatedEventDataSchema,
  UserStatusChangedEventDataSchema,
  RoleChangedEventDataSchema,
  EmailVerifiedEventDataSchema,
  PasswordChangedEventDataSchema,
  MfaChangedEventDataSchema,
  SessionCreatedEventDataSchema,
  SessionRevokedEventDataSchema,
  AllSessionsRevokedEventDataSchema,
  PagePublishedEventDataSchema,
  PageUnpublishedEventDataSchema,
  SeoRedirectUpdatedEventDataSchema,
  TranslationUpdatedEventDataSchema,
  validateEvent,
};
