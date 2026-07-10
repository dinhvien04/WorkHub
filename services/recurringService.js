'use strict';

const RecurringSeries = require('../models/RecurringSeries');
const bookingService = require('./bookingService');
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
    } else {
      cursor = new Date(cursor.getTime() + 86400000);
    }
  }
  return out;
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
    Interval: interval,
    DaysOfWeek: daysOfWeek,
    StartTimeOfDay: startTimeOfDay,
    DurationMinutes: durationMinutes,
    SeriesStart: new Date(seriesStart),
    SeriesEnd: seriesEnd ? new Date(seriesEnd) : null,
    OccurrenceCount: occurrenceCount,
    Status: 'active',
    BookingIDs: [],
  });

  const occurrences = buildOccurrences(series, Math.min(occurrenceCount || 8, 12));
  const created = [];
  const failed = [];

  for (const oc of occurrences) {
    try {
      const booking = await bookingService.createBooking({
        customerId,
        spaceId,
        startTime: oc.start,
        endTime: oc.end,
        note: `Recurring ${series._id}`,
      });
      created.push(booking._id);
    } catch (err) {
      failed.push({ start: oc.start, error: err.message });
    }
  }

  series.BookingIDs = created;
  await series.save();
  return { series, createdCount: created.length, failed };
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

module.exports = { createSeries, cancelSeries, buildOccurrences };
