"use strict";

const Notification = require("../models/Notification");

async function createInboxNotification({ userId, title, body, type, entityType, entityId, link }, options = {}) {
  const session = options.session;

  const [doc] = await Notification.create(
    [
      {
        UserID: userId,
        Title: title,
        Body: body || "",
        Type: type || "system",
        EntityType: entityType || "",
        EntityID: entityId || null,
        IsRead: false,
        Link: link || "",
      },
    ],
    { session }
  );

  return doc;
}

module.exports = {
  createInboxNotification,
};
