"use strict";

const asyncHandler = require("../utils/asyncHandler");
const searchService = require("../services/searchService");
const featuredService = require("../services/featuredService");
const hostBulkService = require("../services/hostBulkService");
const publicHostService = require("../services/publicHostService");
const Review = require("../models/Review");
const Space = require("../models/Space");

const {
  NotFoundError,
  ValidationError,
} = require("../utils/errors");

// —— Search ——
const search = asyncHandler(async (req, res) => {
  const data = await searchService.searchBranches(req.query);
  res.json(data);
});

const autocomplete = asyncHandler(async (req, res) => {
  const data = await searchService.autocomplete(req.query.q || "");
  res.json(data);
});

const searchFacets = asyncHandler(async (req, res) => {
  const data = await searchService.getSearchFacets();
  res.json(data);
});

const featured = asyncHandler(async (req, res) => {
  const [items, newest] = await Promise.all([
    featuredService.getFeaturedListings({ limit: req.query.limit }),
    featuredService.getNewListings({ limit: req.query.newLimit || 6 }),
  ]);
  res.json({ featured: items, newest });
});

// —— Branch Status / Publish (Host) ——
const setBranchStatusHost = asyncHandler(async (req, res) => {
  const result = await hostBulkService.setBranchStatus({
    actorId: req.user.userId,
    role: "host",
    branchId: req.params.branchId,
    status: req.body.status,
    note: req.body.note,
  });
  res.json(result);
});

const setBranchPublishHost = asyncHandler(async (req, res) => {
  const result = await hostBulkService.setBranchPublishStatus({
    actorId: req.user.userId,
    role: req.user.role === "admin" ? "admin" : "host",
    branchId: req.params.branchId,
    publishStatus: req.body.publishStatus || req.body.status,
    note: req.body.note,
  });
  res.json(result);
});

// —— Review report / moderate / host reply ——
const reportReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw new NotFoundError("Không tìm thấy review.");
  const reason = String(req.body.reason || "abuse").slice(0, 500);
  const reporterId = String(req.user.userId);
  const reporters = Array.isArray(review.ReportedBy)
    ? review.ReportedBy.map(String)
    : [];
  if (reporters.includes(reporterId)) {
    return res.json({
      review,
      message: "Bạn đã báo cáo review này.",
      duplicate: true,
    });
  }
  review.ReportedBy = [...(review.ReportedBy || []), req.user.userId].slice(
    -200,
  );
  review.ReportCount = (review.ReportedBy || []).length;
  review.ReportReasons = [...(review.ReportReasons || []), reason].slice(-20);
  if (review.Status === "published") review.Status = "reported";
  await review.save();
  res.json({ review, message: "Đã gửi báo cáo review." });
});

const moderateReview = asyncHandler(async (req, res) => {
  const status = req.body.status;
  if (!["published", "hidden", "removed"].includes(status)) {
    throw new ValidationError("Status không hợp lệ.");
  }
  const review = await Review.findByIdAndUpdate(
    req.params.reviewId,
    {
      $set: {
        Status: status,
        ModeratedBy: req.user.userId,
        ModeratedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!review) throw new NotFoundError("Không tìm thấy review.");
  res.json({ review });
});

const hostReplyReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw new NotFoundError("Không tìm thấy review.");
  const space = await Space.findById(review.SpaceID).select("HostID");
  if (!space || String(space.HostID) !== String(req.user.userId)) {
    throw new ValidationError("Chỉ host của listing mới được trả lời.");
  }
  review.HostReply = String(req.body.reply || "").slice(0, 2000);
  review.HostRepliedAt = new Date();
  await review.save();
  res.json({ review });
});

const listHostReviews = asyncHandler(async (req, res) => {
  const spaces = await Space.find({ HostID: req.user.userId })
    .select("_id")
    .lean();
  const spaceIds = spaces.map((s) => s._id);
  if (!spaceIds.length) return res.json({ reviews: [] });
  const filter = { SpaceID: { $in: spaceIds } };
  if (req.query.status) filter.Status = String(req.query.status);
  if (req.query.unreplied === "1") {
    filter.$or = [
      { HostReply: { $in: [null, ""] } },
      { HostReply: { $exists: false } },
    ];
  }
  const reviews = await Review.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 50, 100))
    .populate("CustomerID", "FullName")
    .populate("SpaceID", "Name SpaceCode")
    .lean();
  res.json({ reviews });
});

const listAdminReviews = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    filter.Status = String(req.query.status);
  } else {
    filter.Status = { $in: ["reported", "hidden"] };
  }
  const reviews = await Review.find(filter)
    .sort({ ReportCount: -1, createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 50, 100))
    .populate("CustomerID", "FullName")
    .populate("SpaceID", "Name HostID")
    .lean();
  res.json({ reviews });
});

// —— Public host profile (no secrets) ——
const publicHostProfile = asyncHandler(async (req, res) => {
  const data = await publicHostService.getPublicHostProfile(
    req.params.hostId,
  );
  res.json({ host: data });
});

module.exports = {
  search,
  autocomplete,
  searchFacets,
  featured,
  setBranchStatusHost,
  setBranchPublishHost,
  reportReview,
  moderateReview,
  hostReplyReview,
  listHostReviews,
  listAdminReviews,
  publicHostProfile,
};
