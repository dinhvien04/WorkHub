"use strict";

/**
 * Recurring bookings — interval-aware weekly generator, branch timezone.
 * Preview and create share the same occurrence generator.
 */
const RecurringSeries = require("../models/RecurringSeries");
const bookingService = require("./bookingService");
const bookingQuoteService = require("./bookingQuoteService");
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");

function parseHm(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/**
 * Get wall-clock parts in a timezone (no luxon dependency).
 */
function zonedParts(date, timeZone) {
  const tz = timeZone || "Asia/Ho_Chi_Minh";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(date).map((p) => [p.type, p.value]),
    );
    const weekdayMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
      dow: weekdayMap[parts.weekday] ?? date.getDay(),
    };
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      dow: date.getDay(),
    };
  }
}

/** Build a Date that represents local wall time in timezone (approx via offset probe). */
function dateInTimeZone(y, mo, d, h, mi, timeZone) {
  const tz = timeZone || "Asia/Ho_Chi_Minh";
  // Iteratively find UTC instant whose zoned parts match
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const want = Date.UTC(y, mo - 1, d, h, mi, 0);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    guess = new Date(guess.getTime() + (want - got));
  }
  return guess;
}

function addDays(y, mo, d, n) {
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/**
 * Build occurrences with Interval respected for weekly + DaysOfWeek.
 * maxCap: hard cap for create (default 52); preview may pass lower.
 */
function buildOccurrences(series, maxCap = 52, timeZone = "Asia/Ho_Chi_Minh") {
  const out = [];
  const { h, m } = parseHm(series.StartTimeOfDay);
  const interval = Math.max(1, Number(series.Interval) || 1);
  const daysOfWeek = Array.isArray(series.DaysOfWeek)
    ? series.DaysOfWeek.map(Number)
    : [];
  const startParts = zonedParts(new Date(series.SeriesStart), timeZone);
  let y = startParts.year;
  let mo = startParts.month;
  let d = startParts.day;

  const endLimit = series.SeriesEnd ? new Date(series.SeriesEnd) : null;
  const countLimit = Math.min(
    maxCap,
    Math.max(1, Number(series.OccurrenceCount) || 8),
  );

  let weekIndex = 0;
  let guard = 0;
  const maxGuard = Math.max(countLimit * 14, 500);

  while (out.length < countLimit && guard < maxGuard) {
    guard += 1;
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    // For weekly with DaysOfWeek: only include days in set, and only weeks
    // where weekIndex % interval === 0 (series week 0, interval, 2*interval...)
    let include = true;
    if (series.Frequency === "weekly" && daysOfWeek.length) {
      // weekIndex = whole weeks since series start
      const dayOffset = Math.floor(
        (Date.UTC(y, mo - 1, d) -
          Date.UTC(startParts.year, startParts.month - 1, startParts.day)) /
          86400000,
      );
      weekIndex = Math.floor(dayOffset / 7);
      include = daysOfWeek.includes(dow) && weekIndex % interval === 0;
    }

    if (include) {
      const start = dateInTimeZone(y, mo, d, h, m, timeZone);
      if (endLimit && start > endLimit) break;
      if (start.getTime() > Date.now() - 60000) {
        const end = new Date(
          start.getTime() +
            Math.max(30, Number(series.DurationMinutes) || 60) * 60000,
        );
        out.push({
          start,
          end,
          occurrenceKey: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`,
        });
      }
    }

    if (series.Frequency === "daily") {
      const next = addDays(y, mo, d, interval);
      y = next.year;
      mo = next.month;
      d = next.day;
    } else if (series.Frequency === "weekly" && daysOfWeek.length) {
      // Advance one calendar day; filter + interval gate above
      const next = addDays(y, mo, d, 1);
      y = next.year;
      mo = next.month;
      d = next.day;
    } else {
      // weekly without DOW: jump Interval weeks
      const next = addDays(y, mo, d, interval * 7);
      y = next.year;
      mo = next.month;
      d = next.day;
    }
  }
  return out;
}

async function resolveBranchTimezone(spaceId) {
  try {
    const Space = require("../models/Space");
    const Branch = require("../models/Branch");
    const space = await Space.findById(spaceId).select("BranchID").lean();
    if (!space?.BranchID) return "Asia/Ho_Chi_Minh";
    const branch = await Branch.findById(space.BranchID)
      .select("Timezone")
      .lean();
    return branch?.Timezone || "Asia/Ho_Chi_Minh";
  } catch {
    return "Asia/Ho_Chi_Minh";
  }
}

async function previewSeries({
  spaceId,
  frequency,
  interval = 1,
  daysOfWeek = [],
  startTimeOfDay,
  durationMinutes,
  seriesStart,
  seriesEnd = null,
  occurrenceCount = 8,
  max = 52,
}) {
  if (!["daily", "weekly"].includes(frequency)) {
    throw new ValidationError("Frequency không hợp lệ (daily|weekly).");
  }
  if (!spaceId) throw new ValidationError("Thiếu spaceId.");
  if (!startTimeOfDay || !durationMinutes) {
    throw new ValidationError("Thiếu startTimeOfDay hoặc durationMinutes.");
  }
  if (!seriesStart) throw new ValidationError("Thiếu seriesStart.");

  const timeZone = await resolveBranchTimezone(spaceId);
  const draft = {
    Frequency: frequency,
    Interval: Math.max(1, Number(interval) || 1),
    DaysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek.map(Number) : [],
    StartTimeOfDay: startTimeOfDay,
    DurationMinutes: Math.max(30, Number(durationMinutes) || 60),
    SeriesStart: new Date(seriesStart),
    SeriesEnd: seriesEnd ? new Date(seriesEnd) : null,
    OccurrenceCount: Math.min(52, Math.max(1, Number(occurrenceCount) || 8)),
  };

  const occurrences = buildOccurrences(
    draft,
    Math.min(draft.OccurrenceCount, max),
    timeZone,
  );
  const items = [];
  let estimatedTotal = 0;
  for (const oc of occurrences) {
    let quote = null;
    try {
      quote = await bookingQuoteService.quoteBooking({
        spaceId,
        startTime: oc.start,
        endTime: oc.end,
      });
      if (quote && quote.ok !== false) {
        estimatedTotal += quote.totalAmount || 0;
      } else quote = null;
    } catch {
      quote = null;
    }
    items.push({
      startTime: oc.start.toISOString(),
      endTime: oc.end.toISOString(),
      occurrenceKey: oc.occurrenceKey,
      totalAmount: quote?.totalAmount ?? null,
      depositAmount: quote?.depositAmount ?? null,
    });
  }

  return {
    frequency: draft.Frequency,
    interval: draft.Interval,
    daysOfWeek: draft.DaysOfWeek,
    timeZone,
    occurrenceCount: items.length,
    estimatedTotal,
    occurrences: items,
  };
}

async function createSeries({
  customerId,
  spaceId,
  hostId,
  frequency,
  interval = 1,
  daysOfWeek = [],
  startTimeOfDay,
  durationMinutes,
  seriesStart,
  seriesEnd = null,
  occurrenceCount = 8,
  idempotencyKey = null,
}) {
  if (!["daily", "weekly"].includes(frequency)) {
    throw new ValidationError("Frequency không hợp lệ.");
  }
  if (!startTimeOfDay || !durationMinutes) {
    throw new ValidationError("Thiếu thời gian lặp.");
  }

  if (idempotencyKey) {
    const existing = await RecurringSeries.findOne({
      IdempotencyKey: idempotencyKey,
      CustomerID: customerId,
    });
    if (existing) {
      return {
        series: existing,
        createdCount: (existing.BookingIDs || []).length,
        failed: [],
        bookingIds: existing.BookingIDs || [],
        duplicate: true,
      };
    }
  }

  const timeZone = await resolveBranchTimezone(spaceId);
  const wanted = Math.min(52, Math.max(1, Number(occurrenceCount) || 8));

  let series;
  try {
    series = await RecurringSeries.create({
      CustomerID: customerId,
      SpaceID: spaceId,
      HostID: hostId,
      Frequency: frequency,
      Interval: Math.max(1, Number(interval) || 1),
      DaysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek.map(Number) : [],
      StartTimeOfDay: startTimeOfDay,
      DurationMinutes: Math.max(30, Number(durationMinutes) || 60),
      SeriesStart: new Date(seriesStart),
      SeriesEnd: seriesEnd ? new Date(seriesEnd) : null,
      OccurrenceCount: wanted,
      Status: "active",
      BookingIDs: [],
      IdempotencyKey: idempotencyKey || undefined,
      Timezone: timeZone,
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      const again = await RecurringSeries.findOne({
        IdempotencyKey: idempotencyKey,
      });
      if (again) {
        return {
          series: again,
          createdCount: (again.BookingIDs || []).length,
          failed: [],
          bookingIds: again.BookingIDs || [],
          duplicate: true,
        };
      }
    }
    throw err;
  }

  // Same generator as preview — up to 52 occurrences (not hard-capped at 12)
  const occurrences = buildOccurrences(series, wanted, timeZone);
  const created = [];
  const failed = [];

  for (const oc of occurrences) {
    try {
      const booking = await bookingService.createBooking({
        customerId,
        spaceId,
        startTime: oc.start,
        endTime: oc.end,
        note: `Recurring series ${series._id}`,
      });
      try {
        await require("../models/Booking").updateOne(
          { _id: booking._id },
          {
            $set: {
              SeriesID: series._id,
              OccurrenceKey: oc.occurrenceKey,
            },
          },
        );
      } catch {
        /* optional fields */
      }
      created.push(booking._id);
    } catch (err) {
      failed.push({
        start: oc.start,
        occurrenceKey: oc.occurrenceKey,
        error: err.message,
      });
    }
  }

  series.BookingIDs = created;
  if (failed.length && !created.length) {
    series.Status = "cancelled";
  }
  await series.save();
  return {
    series,
    createdCount: created.length,
    failed,
    bookingIds: created,
    timeZone,
  };
}

async function listSeries(userId) {
  return RecurringSeries.find({ CustomerID: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

/**
 * Cancel series modes:
 * - whole: cancel series + all non-terminal children
 * - this_and_future: from occurrence onward; series stays active if past remain
 * - this: single occurrence
 */
async function cancelSeries(
  seriesId,
  userId,
  { mode = "whole", occurrenceBookingId = null } = {},
) {
  const series = await RecurringSeries.findById(seriesId);
  if (!series) throw new NotFoundError("Không tìm thấy series.");
  if (String(series.CustomerID) !== String(userId)) {
    throw new ForbiddenError("Không có quyền.");
  }

  const Booking = require("../models/Booking");
  const BookingSlot = require("../models/BookingSlot");
  const protectedStatuses = new Set(["completed", "in-use", "no_show"]);
  const now = new Date();
  const ids = (series.BookingIDs || []).map(String);

  let targetIds = ids;
  if (mode === "this" && occurrenceBookingId) {
    targetIds = ids.filter((id) => id === String(occurrenceBookingId));
  } else if (mode === "this_and_future" && occurrenceBookingId) {
    const occ = await Booking.findById(occurrenceBookingId)
      .select("StartTime")
      .lean();
    if (!occ) throw new NotFoundError("Occurrence not found.");
    const future = await Booking.find({
      _id: { $in: series.BookingIDs },
      StartTime: { $gte: occ.StartTime },
    })
      .select("_id")
      .lean();
    targetIds = future.map((b) => String(b._id));
  }

  let cancelled = 0;
  for (const id of targetIds) {
    const b = await Booking.findOne({
      _id: id,
      CustomerID: userId,
    });
    if (!b) continue;
    if (protectedStatuses.has(b.Status)) continue;
    if (["cancelled", "expired", "rejected"].includes(b.Status)) continue;
    b.Status = "cancelled";
    b.CancelledAt = now;
    b.CancelledBy = userId;
    b.CancelReason = `series_cancel:${mode}`;
    await b.save();
    await BookingSlot.deleteMany({ BookingID: b._id });
    cancelled += 1;
  }

  if (mode === "whole") {
    series.Status = "cancelled";
    await series.save();
  } else if (mode === "this_and_future") {
    // Only mark series cancelled if no active future remains
    const remaining = await Booking.countDocuments({
      _id: { $in: series.BookingIDs },
      Status: {
        $nin: ["cancelled", "expired", "rejected", "completed", "no_show"],
      },
      StartTime: { $gte: now },
    });
    if (remaining === 0) {
      series.Status = "cancelled";
      await series.save();
    }
  }

  return {
    series: series.toObject ? series.toObject() : series,
    cancelledCount: cancelled,
    mode,
  };
}

module.exports = {
  createSeries,
  cancelSeries,
  buildOccurrences,
  previewSeries,
  listSeries,
  resolveBranchTimezone,
};
