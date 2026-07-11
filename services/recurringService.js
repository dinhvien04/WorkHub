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
  ConflictError,
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
  const Space = require("../models/Space");
  const Branch = require("../models/Branch");
  let space;
  let branch;
  try {
    space = await Space.findById(spaceId).select("BranchID").lean();
  } catch (err) {
    const e = new Error("Không đọc được space timezone (DB). Thử lại sau.");
    e.statusCode = 503;
    e.isOperational = true;
    e.cause = err;
    throw e;
  }
  if (!space?.BranchID) return "Asia/Ho_Chi_Minh";
  try {
    branch = await Branch.findById(space.BranchID).select("Timezone").lean();
  } catch (err) {
    const e = new Error("Không đọc được branch timezone (DB). Thử lại sau.");
    e.statusCode = 503;
    e.isOperational = true;
    e.cause = err;
    throw e;
  }
  const tz = branch?.Timezone || "Asia/Ho_Chi_Minh";
  // Validate IANA timezone when runtime supports it
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const all = Intl.supportedValuesOf("timeZone");
      if (all && !all.includes(tz)) {
        throw new ValidationError(`Timezone không hợp lệ: ${tz}`);
      }
    }
  } catch (err) {
    if (err.statusCode) throw err;
  }
  return tz;
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
  if (!idempotencyKey) {
    throw new ValidationError(
      "Idempotency-Key là bắt buộc cho recurring series creation.",
    );
  }

  const crypto = require("crypto");
  const RecurringOccurrence = require("../models/RecurringOccurrence");
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      [
        String(customerId),
        String(spaceId),
        String(frequency),
        String(interval || 1),
        JSON.stringify(daysOfWeek || []),
        String(startTimeOfDay),
        String(durationMinutes),
        String(seriesStart),
        String(seriesEnd || ""),
        String(occurrenceCount || 8),
      ].join("|"),
    )
    .digest("hex");

  // Scope client key by customer
  const scopedKey = crypto
    .createHash("sha256")
    .update(`recurring:${customerId}:${idempotencyKey}`)
    .digest("hex");

  const existing = await RecurringSeries.findOne({
    IdempotencyKey: scopedKey,
    CustomerID: customerId,
  });
  if (existing) {
    if (
      existing.Meta?.fingerprint &&
      existing.Meta.fingerprint !== fingerprint
    ) {
      throw new ConflictError(
        "Idempotency-Key đã dùng với request fingerprint khác.",
      );
    }
    if (["draft", "creating", "partial", "failed"].includes(existing.Status)) {
      return resumeSeriesCreation(existing);
    }
    return {
      series: existing,
      createdCount: (existing.BookingIDs || []).length,
      failed: [],
      bookingIds: existing.BookingIDs || [],
      duplicate: true,
    };
  }

  const timeZone = await resolveBranchTimezone(spaceId);
  const wanted = Math.min(52, Math.max(1, Number(occurrenceCount) || 8));

  let series;
  try {
    // Start as draft/creating — never mark active before children exist
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
      Status: "creating",
      BookingIDs: [],
      IdempotencyKey: scopedKey,
      Timezone: timeZone,
      Meta: { fingerprint, clientKey: String(idempotencyKey).slice(0, 80) },
    });
  } catch (err) {
    if (err.code === 11000) {
      const again = await RecurringSeries.findOne({
        IdempotencyKey: scopedKey,
      });
      if (again) {
        if (again.Meta?.fingerprint && again.Meta.fingerprint !== fingerprint) {
          throw new ConflictError(
            "Idempotency-Key đã dùng với request fingerprint khác.",
          );
        }
        if (["draft", "creating", "partial", "failed"].includes(again.Status)) {
          return resumeSeriesCreation(again);
        }
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

  const occurrences = buildOccurrences(series, wanted, timeZone);
  // Upsert occurrence plan rows (unique SeriesID+OccurrenceKey)
  for (const oc of occurrences) {
    try {
      await RecurringOccurrence.updateOne(
        { SeriesID: series._id, OccurrenceKey: oc.occurrenceKey },
        {
          $setOnInsert: {
            SeriesID: series._id,
            OccurrenceKey: oc.occurrenceKey,
            StartTime: oc.start,
            EndTime: oc.end,
            Status: "pending",
            Attempts: 0,
          },
        },
        { upsert: true },
      );
    } catch {
      /* ignore race */
    }
  }

  return resumeSeriesCreation(series);
}

/**
 * Resume missing occurrences — never duplicate children.
 */
async function resumeSeriesCreation(series) {
  const RecurringOccurrence = require("../models/RecurringOccurrence");
  const Booking = require("../models/Booking");
  const timeZone = series.Timezone || "Asia/Ho_Chi_Minh";
  const wanted = series.OccurrenceCount || 8;

  series.Status = "creating";
  await series.save();

  // Ensure occurrence plan exists
  let plan = await RecurringOccurrence.find({ SeriesID: series._id });
  if (!plan.length) {
    const built = buildOccurrences(series, wanted, timeZone);
    for (const oc of built) {
      try {
        await RecurringOccurrence.create({
          SeriesID: series._id,
          OccurrenceKey: oc.occurrenceKey,
          StartTime: oc.start,
          EndTime: oc.end,
          Status: "pending",
        });
      } catch {
        /* dup ok */
      }
    }
    plan = await RecurringOccurrence.find({ SeriesID: series._id });
  }

  const created = [...(series.BookingIDs || []).map(String)];
  const failed = [];

  const workerId = `recurring-${process.pid}-${Date.now()}`;
  const leaseMs = 120_000;
  const now = new Date();

  for (const row of plan) {
    if (row.Status === "created" && row.BookingID) {
      if (!created.includes(String(row.BookingID))) {
        created.push(String(row.BookingID));
      }
      continue;
    }
    if (row.Status === "cancelled" || row.Status === "failed_terminal")
      continue;

    // Repair: existing booking with same occurrence key
    const orphan = await Booking.findOne({
      SeriesID: series._id,
      OccurrenceKey: row.OccurrenceKey,
    })
      .select("_id")
      .lean();
    if (orphan) {
      await RecurringOccurrence.updateOne(
        { _id: row._id },
        {
          $set: {
            Status: "created",
            BookingID: orphan._id,
            FailureCode: "",
            ProcessingBy: "",
            LeaseUntil: null,
          },
        },
      );
      if (!created.includes(String(orphan._id)))
        created.push(String(orphan._id));
      continue;
    }

    // CAS claim occurrence
    const claimed = await RecurringOccurrence.findOneAndUpdate(
      {
        _id: row._id,
        Status: { $in: ["pending", "failed", "failed_retryable"] },
        $or: [
          { LeaseUntil: null },
          { LeaseUntil: { $lte: now } },
          { Status: { $ne: "processing" } },
        ],
      },
      {
        $set: {
          Status: "processing",
          ProcessingBy: workerId,
          LeaseUntil: new Date(now.getTime() + leaseMs),
        },
        $inc: { Attempts: 1 },
      },
      { new: true },
    );
    if (!claimed) continue; // another worker holds lease

    try {
      const booking = await bookingService.createBooking({
        customerId: series.CustomerID,
        spaceId: series.SpaceID,
        startTime: row.StartTime,
        endTime: row.EndTime,
        note: `Recurring series ${series._id}`,
      });
      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            SeriesID: series._id,
            OccurrenceKey: row.OccurrenceKey,
          },
        },
      );
      await RecurringOccurrence.updateOne(
        {
          _id: row._id,
          Status: "processing",
          ProcessingBy: workerId,
        },
        {
          $set: {
            Status: "created",
            BookingID: booking._id,
            FailureCode: "",
            ProcessingBy: "",
            LeaseUntil: null,
          },
        },
      );
      created.push(String(booking._id));
    } catch (err) {
      const terminal = (claimed.Attempts || 0) >= 5;
      await RecurringOccurrence.updateOne(
        {
          _id: row._id,
          Status: "processing",
          ProcessingBy: workerId,
        },
        {
          $set: {
            Status: terminal ? "failed_terminal" : "failed_retryable",
            FailureCode: String(err.code || err.message || "error").slice(
              0,
              100,
            ),
            ProcessingBy: "",
            LeaseUntil: null,
          },
        },
      );
      failed.push({
        start: row.StartTime,
        occurrenceKey: row.OccurrenceKey,
        error: err.message,
      });
    }
  }

  series.BookingIDs = created;
  if (!created.length && failed.length) {
    series.Status = "failed";
  } else if (failed.length) {
    series.Status = "partial";
  } else {
    series.Status = "active";
  }
  await series.save();

  return {
    series,
    createdCount: created.length,
    failed,
    bookingIds: created,
    timeZone,
    resumed: true,
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
  resumeSeriesCreation,
  createSeries,
  cancelSeries,
  buildOccurrences,
  previewSeries,
  listSeries,
  resolveBranchTimezone,
};
