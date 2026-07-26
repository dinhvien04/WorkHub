"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const { messaging } = require("@workhub/observability");
const env = require("../config/env");

const ProcessedMessage = require("../models/ProcessedMessage");
const UserCache = require("../models/UserCache");
const NotificationPreference = require("../models/NotificationPreference");
const ConsumerDeadLetter = require("../models/ConsumerDeadLetter");

const notificationService = require("./notificationService");
const emailService = require("./emailService");
const pushService = require("./pushService");

const QUEUE_NAME = "communication-service-queue";
const CONSUMER_NAME = "communication-service";

let amqpConnection = null;
let amqpChannel = null;

function isConnected() {
  return amqpConnection && amqpConnection.connection ? true : false;
}

/**
 * Inbox Pattern implementation for event idempotency.
 */
async function processIdempotent(eventId, callback) {
  const existing = await ProcessedMessage.findOne({ EventID: eventId, ConsumerName: CONSUMER_NAME });
  if (existing) {
    if (existing.Status === "completed") {
      return { status: "skipped", reason: "already_processed" };
    }
    if (existing.Status === "processing") {
      throw new Error(`Event ${eventId} is currently processing by consumer ${CONSUMER_NAME}`);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let inboxDoc;
    try {
      [inboxDoc] = await ProcessedMessage.create(
        [{ EventID: eventId, ConsumerName: CONSUMER_NAME, Status: "processing" }],
        { session }
      );
    } catch (err) {
      if (err.code === 11000) {
        await session.abortTransaction();
        session.endSession();
        return { status: "skipped", reason: "already_processed_concurrent" };
      }
      throw err;
    }

    const result = await callback(session);

    inboxDoc.Status = "completed";
    inboxDoc.ProcessedAt = new Date();
    await inboxDoc.save({ session });

    await session.commitTransaction();
    session.endSession();
    return { status: "processed", result };
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch (_) {}
    session.endSession();
    throw error;
  }
}

/**
 * Ensure a local UserCache stub exists for references
 */
async function ensureUserCacheStub(userId, email, fullName, session) {
  const user = await UserCache.findById(userId).session(session);
  if (!user) {
    await UserCache.create(
      [{
        _id: userId,
        Email: email || `user-${userId}@workhub.local`,
        FullName: fullName || "User",
        Role: "customer",
        Status: "active",
      }],
      { session }
    );

    await NotificationPreference.create(
      [{
        UserID: userId,
        NotifyEmail: true,
        NotifyPush: true,
        NotifySms: false,
        MarketingOptIn: false,
        PreferredLang: "vi",
        Timezone: "Asia/Ho_Chi_Minh",
      }],
      { session }
    );
  }
}

async function handleUserCreated(event) {
  await processIdempotent(event.eventId, async (session) => {
    await UserCache.findOneAndUpdate(
      { _id: event.data.userId },
      {
        $set: {
          Email: event.data.email,
          FullName: event.data.fullName,
          Role: event.data.role,
          Status: event.data.status,
          tokenVersion: event.data.tokenVersion || 0,
        },
      },
      { upsert: true, session }
    );

    await NotificationPreference.findOneAndUpdate(
      { UserID: event.data.userId },
      {
        $setOnInsert: {
          NotifyEmail: true,
          NotifyPush: true,
          NotifySms: false,
          MarketingOptIn: false,
          PreferredLang: "vi",
          Timezone: "Asia/Ho_Chi_Minh",
        },
      },
      { upsert: true, session }
    );
  });
}

async function handleUserUpdated(event) {
  await processIdempotent(event.eventId, async (session) => {
    const updates = {};
    if (event.data.email) updates.Email = event.data.email;
    if (event.data.fullName) updates.FullName = event.data.fullName;
    if (event.data.role) updates.Role = event.data.role;
    if (event.data.status) updates.Status = event.data.status;
    if (event.data.tokenVersion !== undefined) updates.tokenVersion = event.data.tokenVersion;

    await UserCache.updateOne(
      { _id: event.data.userId },
      { $set: updates },
      { session }
    );
  });
}

/**
 * Identity asked us to deliver a transactional email.
 *
 * Identity never contacts an email provider itself — it records the intent in
 * its outbox and this consumer owns delivery, retries and rendering. These are
 * security-critical mails (verification tokens, reset OTPs), so they bypass
 * marketing preferences but still go through the normal outbox + worker path.
 */
async function handleEmailRequested(event) {
  await processIdempotent(event.eventId, async (session) => {
    const { userId, toEmail, template, data } = event.data;

    await emailService.enqueueTemplate(
      {
        template,
        recipientId: userId || toEmail,
        toEmail,
        data: data || {},
      },
      { session, idempotencyKey: `identity-email:${event.eventId}` },
    );
  });
}

async function handleReviewReplied(event) {
  await processIdempotent(event.eventId, async (session) => {
    const { reviewId, customerId, replyText } = event.data;

    await ensureUserCacheStub(customerId, null, null, session);

    const prefs = await NotificationPreference.findOne({ UserID: customerId }).session(session);

    // 1. Create In-App Notification
    await notificationService.createInboxNotification({
      userId: customerId,
      title: "Chủ cơ sở đã trả lời đánh giá",
      body: replyText,
      type: "host",
      entityType: "Review",
      entityId: reviewId,
    }, { session });

    // 2. Queue Email outbox
    if (!prefs || prefs.NotifyEmail !== false) {
      const customer = await UserCache.findById(customerId).session(session);
      await emailService.enqueueTemplate({
        template: "generic",
        recipientId: customerId,
        toEmail: customer.Email,
        data: {
          subject: "Phản hồi đánh giá mới - WorkHub",
          text: `Chủ cơ sở đã phản hồi đánh giá của bạn: "${replyText}"`,
        },
      }, { session });
    }

    // 3. Queue Push outbox
    if (!prefs || prefs.NotifyPush !== false) {
      await pushService.enqueuePush({
        recipientId: customerId,
        title: "Phản hồi đánh giá mới",
        body: replyText,
      }, { session });
    }
  });
}

async function handleBookingConfirmed(event) {
  await processIdempotent(event.eventId, async (session) => {
    const { bookingId, customerId, spaceName, startTime, endTime } = event.data;

    await ensureUserCacheStub(customerId, null, null, session);

    const prefs = await NotificationPreference.findOne({ UserID: customerId }).session(session);

    await notificationService.createInboxNotification({
      userId: customerId,
      title: "Booking đã xác nhận",
      body: spaceName,
      type: "booking",
      entityType: "Booking",
      entityId: bookingId,
      link: "/dashboard",
    }, { session });

    if (!prefs || prefs.NotifyEmail !== false) {
      const customer = await UserCache.findById(customerId).session(session);
      await emailService.enqueueTemplate({
        template: "booking_confirmed",
        recipientId: customerId,
        toEmail: customer.Email,
        data: {
          spaceName,
          startTime,
          endTime,
          bookingId,
        },
      }, { session });
    }

    if (!prefs || prefs.NotifyPush !== false) {
      await pushService.enqueuePush({
        recipientId: customerId,
        title: "Booking đã xác nhận",
        body: spaceName,
        url: "/dashboard",
      }, { session });
    }
  });
}

async function handleBookingCancelled(event) {
  await processIdempotent(event.eventId, async (session) => {
    const { bookingId, customerId, hostId, spaceName, startTime, reason, cancelledBy } = event.data;

    const recipientId = cancelledBy === "host" ? customerId : hostId;
    await ensureUserCacheStub(recipientId, null, null, session);

    const prefs = await NotificationPreference.findOne({ UserID: recipientId }).session(session);

    await notificationService.createInboxNotification({
      userId: recipientId,
      title: "Đơn đặt chỗ đã bị hủy",
      body: spaceName,
      type: "booking",
      entityType: "Booking",
      entityId: bookingId,
    }, { session });

    if (!prefs || prefs.NotifyEmail !== false) {
      const user = await UserCache.findById(recipientId).session(session);
      await emailService.enqueueTemplate({
        template: "booking_cancelled",
        recipientId: recipientId,
        toEmail: user.Email,
        data: {
          spaceName,
          startTime,
          reason,
          bookingId,
        },
      }, { session });
    }

    if (!prefs || prefs.NotifyPush !== false) {
      await pushService.enqueuePush({
        recipientId,
        title: "Đơn đặt chỗ đã bị hủy",
        body: spaceName,
      }, { session });
    }
  });
}

async function handlePaymentSucceeded(event) {
  await processIdempotent(event.eventId, async (session) => {
    const { bookingId, amount, customerId } = event.data;

    await ensureUserCacheStub(customerId, null, null, session);
    const prefs = await NotificationPreference.findOne({ UserID: customerId }).session(session);

    await notificationService.createInboxNotification({
      userId: customerId,
      title: "Thanh toán thành công",
      body: `${Number(amount).toLocaleString("vi-VN")}đ`,
      type: "payment",
      entityType: "Booking",
      entityId: bookingId,
      link: `/booking/detail?id=${bookingId}`,
    }, { session });

    if (!prefs || prefs.NotifyEmail !== false) {
      const customer = await UserCache.findById(customerId).session(session);
      await emailService.enqueueTemplate({
        template: "payment_received",
        recipientId: customerId,
        toEmail: customer.Email,
        data: {
          spaceName: "đơn hàng",
          amount,
          bookingId,
        },
      }, { session });
    }

    if (!prefs || prefs.NotifyPush !== false) {
      await pushService.enqueuePush({
        recipientId: customerId,
        title: "Thanh toán thành công",
        body: `${Number(amount).toLocaleString("vi-VN")}đ`,
        url: `/booking/detail?id=${bookingId}`,
      }, { session });
    }
  });
}

async function handleRefundCompleted(event) {
  await processIdempotent(event.eventId, async (session) => {
    const { refundId, refundAmount, customerId } = event.data;

    await ensureUserCacheStub(customerId, null, null, session);
    const prefs = await NotificationPreference.findOne({ UserID: customerId }).session(session);

    await notificationService.createInboxNotification({
      userId: customerId,
      title: "Hoàn tiền đã xử lý",
      body: `${Number(refundAmount).toLocaleString("vi-VN")}đ`,
      type: "payment",
      entityType: "Refund",
      entityId: refundId,
    }, { session });

    if (!prefs || prefs.NotifyEmail !== false) {
      const customer = await UserCache.findById(customerId).session(session);
      await emailService.enqueueTemplate({
        template: "generic",
        recipientId: customerId,
        toEmail: customer.Email,
        data: {
          subject: "Hoàn tiền thành công - WorkHub",
          text: `Yêu cầu hoàn tiền trị giá ${Number(refundAmount).toLocaleString("vi-VN")}đ của bạn đã được xử lý thành công.`,
        },
      }, { session });
    }

    if (!prefs || prefs.NotifyPush !== false) {
      await pushService.enqueuePush({
        recipientId: customerId,
        title: "Hoàn tiền đã xử lý",
        body: `${Number(refundAmount).toLocaleString("vi-VN")}đ`,
      }, { session });
    }
  });
}

/**
 * DLQ Logger callback
 */
async function onDeadLetter(msg, event, errReason) {
  const messageId = msg.properties.messageId || (event && event.eventId) || `dl-${crypto.randomUUID()}`;
  try {
    await ConsumerDeadLetter.findOneAndUpdate(
      { MessageID: messageId },
      {
        $set: {
          QueueName: QUEUE_NAME,
          RoutingKey: msg.fields.routingKey,
          Payload: event || {},
          Headers: msg.properties.headers || {},
          Error: errReason,
          Status: "pending",
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error("[ConsumerService] Failed to write dead letter:", err.message);
  }
}

/**
 * Start connection and subscribe to routing keys
 */
async function start() {
  amqpConnection = await messaging.connect(env.RABBITMQ_URL);
  amqpChannel = await messaging.createConfirmChannel(amqpConnection);

  const eventRoutes = {
    "identity.user-created.v1": handleUserCreated,
    "identity.user-updated.v1": handleUserUpdated,
    "identity.email-requested.v1": handleEmailRequested,
    "catalog.review-replied.v1": handleReviewReplied,
    "booking.confirmed.v1": handleBookingConfirmed,
    "booking.cancelled.v1": handleBookingCancelled,
    "billing.payment-succeeded.v1": handlePaymentSucceeded,
    "billing.refund-completed.v1": handleRefundCompleted,
  };

  for (const [key, handler] of Object.entries(eventRoutes)) {
    await messaging.subscribeEvent(amqpChannel, {
      queueName: QUEUE_NAME,
      routingKeyPattern: key,
      handler: async (event) => {
        const res = await handler(event);
        if (res && res.status === "skipped") {
          // Deduplicated message
          return;
        }
      },
      onDeadLetter,
    });
  }

  console.log("[ConsumerService] Subscribed to RabbitMQ queues.");
}

async function stop() {
  if (amqpChannel) {
    await amqpChannel.close().catch(() => {});
  }
  if (amqpConnection) {
    await amqpConnection.close().catch(() => {});
  }
}

module.exports = {
  start,
  stop,
  isConnected,
  onDeadLetter,
};
