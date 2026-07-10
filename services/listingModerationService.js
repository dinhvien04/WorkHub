"use strict";

/**
 * Admin listing moderation: suspend / restore / request changes.
 */
const Branch = require("../models/Branch");
const Space = require("../models/Space");
const { notifyUser } = require("./notificationService");
const { ValidationError, NotFoundError } = require("../utils/errors");

const ACTIONS = ["suspend", "restore", "request_change", "approve"];

/**
 * @param {object} opts
 * @param {'suspend'|'restore'|'request_change'|'approve'} opts.action
 * @param {'branch'|'space'} opts.targetType
 */
async function moderateListing({
  adminId,
  targetType,
  targetId,
  action,
  reason = "",
  note = "",
}) {
  if (!ACTIONS.includes(action)) {
    throw new ValidationError(`Action phải là: ${ACTIONS.join(", ")}`);
  }
  if (!["branch", "space"].includes(targetType)) {
    throw new ValidationError("targetType phải là branch|space.");
  }

  let doc;
  let hostId;
  if (targetType === "branch") {
    doc = await Branch.findById(targetId);
    if (!doc) throw new NotFoundError("Không tìm thấy branch.");
    hostId = doc.HostID;
  } else {
    doc = await Space.findById(targetId);
    if (!doc) throw new NotFoundError("Không tìm thấy space.");
    hostId = doc.HostID;
  }

  const previous = targetType === "branch" ? doc.Status : doc.Status;
  let nextStatus = previous;
  let message = "";

  if (action === "suspend") {
    nextStatus = targetType === "branch" ? "inactive" : "inactive";
    message = "Listing đã bị tạm ngưng.";
  } else if (action === "restore" || action === "approve") {
    nextStatus = targetType === "branch" ? "active" : "available";
    message = "Listing đã được khôi phục / duyệt.";
  } else if (action === "request_change") {
    // Keep live but flag via note notification — optional soft inactive for branch
    message = "Admin yêu cầu chỉnh sửa listing.";
  }

  if (action !== "request_change") {
    doc.Status = nextStatus;
  }

  // Persist moderation meta on document (flexible fields)
  doc.Moderation = {
    LastAction: action,
    Reason: String(reason || "").slice(0, 500),
    Note: String(note || "").slice(0, 2000),
    ModeratedBy: adminId,
    ModeratedAt: new Date(),
  };
  // Use markModified if Mixed; store as nested plain object via set
  if (typeof doc.markModified === "function") {
    doc.markModified("Moderation");
  }
  // If schema doesn't have Moderation, use updateOne $set
  try {
    await doc.save();
  } catch {
    const Model = targetType === "branch" ? Branch : Space;
    await Model.updateOne(
      { _id: targetId },
      {
        $set: {
          ...(action !== "request_change" ? { Status: nextStatus } : {}),
          Moderation: {
            LastAction: action,
            Reason: String(reason || "").slice(0, 500),
            Note: String(note || "").slice(0, 2000),
            ModeratedBy: adminId,
            ModeratedAt: new Date(),
          },
        },
      },
    );
    doc = await Model.findById(targetId);
  }

  try {
    await notifyUser({
      userId: hostId,
      title: `Moderation: ${action}`,
      body: `${message} ${reason || note || ""}`.trim().slice(0, 400),
      type: "system",
      entityType: targetType === "branch" ? "Branch" : "Space",
      entityId: targetId,
    });
  } catch {
    /* ignore */
  }

  try {
    const logActivity = require("../utils/auditLogger");
    await logActivity(
      adminId,
      "LISTING_MODERATE",
      targetType === "branch" ? "Branch" : "Space",
      targetId,
      `${action}: ${reason || note || previous + "→" + nextStatus}`,
      "warning",
    );
  } catch {
    /* ignore */
  }

  return {
    targetType,
    targetId: String(targetId),
    action,
    previousStatus: previous,
    status: doc.Status,
    moderation: doc.Moderation || null,
    message,
  };
}

async function listFlaggedListings({ limit = 50 } = {}) {
  // Branches inactive with moderation note or reported reviews nearby — simple queue
  const branches = await Branch.find({
    $or: [
      { Status: "inactive" },
      { "Moderation.LastAction": { $in: ["suspend", "request_change"] } },
    ],
  })
    .select("Name Status HostID Address City Moderation updatedAt")
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  const spaces = await Space.find({
    $or: [
      { Status: "inactive" },
      { Status: "maintenance" },
      { "Moderation.LastAction": { $in: ["suspend", "request_change"] } },
    ],
  })
    .select(
      "Name SpaceCode Status HostID BranchID PricePerHour Moderation updatedAt",
    )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return { branches, spaces };
}

module.exports = {
  moderateListing,
  listFlaggedListings,
  ACTIONS,
};
