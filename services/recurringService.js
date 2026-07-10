'use strict';

const RecurringSeries = require('../models/RecurringSeries');
const bookingService = require('./bookingService');
const bookingQuoteService = require('./bookingQuoteService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');

function parseHm(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function buildOccurrences(series, max = 12) {
  const out = [];
  const { h, m } = parseHm(series.StartTimeOfDay);
  let cursor = new Date(series.SeriesStart);
  cursor.setHours(h, m, 0, 0);
  const endLimit = series.SeriesEnd ? new Date(series.SeriesEnd) : null;
  const countLimit = series.OccurrenceCount || max;

  let guard = 0;
  while (out.length < Math.min(countLimit, max) && guard < 500) {
    guard += 1;
    if (series.Frequency === 'weekly' && series.DaysOfWeek?.length) {
      if (!series.DaysOfWeek.includes(cursor.getDay())) {
        cursor = new Date(cursor.getTime() + 86400000);
        continue;
      }
    }
    if (endLimit && cursor > endLimit) break;
    if (cursor.getTime() > Date.now() - 60000) {
      const start = new Date(cursor);
      const end = new Date(start.getTime() + series.DurationMinutes * 60000);
      out.push({ start, end });
    }
    if (series.Frequency === 'daily') {
      cursor = new Date(cursor.getTime() + series.Interval * 86400000);
    } else if (series.Frequency === 'weekly' && series.DaysOfWeek?.length) {
      // advance one day; day filter above picks next matching DOW
      cursor = new Date(cursor.getTime() + 86400000);
    } else {
      // weekly without DOW: interval weeks
      cursor = new Date(cursor.getTime() + (series.Interval || 1) * 7 * 86400000);
    }
  }
  return out;
}

/**
 * Preview occurrences + optional per-slot quote totals (no writes).
 */
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
  max = 12,
}) {
  if (!['daily', 'weekly'].includes(frequency)) {
    throw new ValidationError('Frequency không hợp lệ (daily|weekly).');
  }
  if (!spaceId) throw new ValidationError('Thiếu spaceId.');
  if (!startTimeOfDay || !durationMinutes) {
    throw new ValidationError('Thiếu startTimeOfDay hoặc durationMinutes.');
  }
  if (!seriesStart) throw new ValidationError('Thiếu seriesStart.');

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

  const occurrences = buildOccurrences(draft, Math.min(draft.OccurrenceCount, max));
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
      totalAmount: quote?.totalAmount ?? null,
      depositAmount: quote?.depositAmount ?? null,
    });
  }

  return {
    frequency: draft.Frequency,
    interval: draft.Interval,
    daysOfWeek: draft.DaysOfWeek,
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
}) {
  if (!['daily', 'weekly'].includes(frequency)) {
    throw new ValidationError('Frequency không hợp lệ.');
  }
  if (!startTimeOfDay || !durationMinutes) {
    throw new ValidationError('Thiếu thời gian lặp.');
  }

  const series = await RecurringSeries.create({
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
    OccurrenceCount: Math.min(52, Math.max(1, Number(occurrenceCount) || 8)),
    Status: 'active',
    BookingIDs: [],
  });

  const occurrences = buildOccurrences(series, Math.min(series.OccurrenceCount || 8, 12));
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
      created.push(booking._id);
    } catch (err) {
      failed.push({ start: oc.start, error: err.message });
    }
  }

  series.BookingIDs = created;
  await series.save();
  return { series, createdCount: created.length, failed, bookingIds: created };
}

async function listSeries(userId) {
  return RecurringSeries.find({ CustomerID: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

async function cancelSeries(seriesId, userId) {
  const series = await RecurringSeries.findById(seriesId);
  if (!series) throw new NotFoundError('Không tìm thấy series.');
  if (String(series.CustomerID) !== String(userId)) {
    throw new ForbiddenError('Không có quyền.');
  }
  series.Status = 'cancelled';
  await series.save();
  return series;
}

module.exports = {
  createSeries,
  cancelSeries,
  buildOccurrences,
  previewSeries,
  listSeries,
};
