'use strict';

const Booking = require('../models/Booking');
const Space = require('../models/Space');
const { ForbiddenError, ValidationError } = require('../utils/errors');

/**
 * Host calendar events in a date range (host-scoped).
 */
async function getHostCalendar({ hostId, from, to, branchId = null, spaceId = null }) {
  if (!from || !to) throw new ValidationError('Thiếu from/to.');
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new ValidationError('Khoảng thời gian không hợp lệ.');
  }

  const spaceFilter = { HostID: hostId };
  if (branchId) spaceFilter.BranchID = branchId;
  if (spaceId) spaceFilter._id = spaceId;
  const spaces = await Space.find(spaceFilter).select('_id Name SpaceCode BranchID').lean();
  const spaceIds = spaces.map((s) => s._id);
  if (!spaceIds.length) return { spaces, events: [] };

  const bookings = await Booking.find({
    HostID: hostId,
    SpaceID: { $in: spaceIds },
    Status: { $nin: ['cancelled', 'expired', 'rejected', 'draft'] },
    StartTime: { $lt: end },
    EndTime: { $gt: start },
  })
    .populate('CustomerID', 'FullName Email')
    .sort({ StartTime: 1 })
    .lean();

  const events = bookings.map((b) => ({
    id: b._id,
    spaceId: b.SpaceID,
    title: b.Snapshot?.SpaceName || b.SpaceID?.toString(),
    customerName: b.CustomerID?.FullName || '',
    status: b.Status,
    start: b.StartTime,
    end: b.EndTime,
    totalAmount: b.TotalAmount,
  }));

  return { spaces, events };
}

/**
 * Generate ICS content for a booking (customer ownership checked by caller).
 */
function bookingToIcs(booking) {
  const uid = `${booking._id}@workhub`;
  const dt = (d) =>
    new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const summary = (booking.Snapshot?.SpaceName || 'WorkHub booking').replace(/\n/g, ' ');
  const location = (booking.Snapshot?.Address || '').replace(/\n/g, ' ');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorkHub//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dt(new Date())}`,
    `DTSTART:${dt(booking.StartTime)}`,
    `DTEND:${dt(booking.EndTime)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Deep links for Google Calendar / Outlook web.
 */
function calendarDeepLinks(booking) {
  const title = encodeURIComponent(booking.Snapshot?.SpaceName || 'WorkHub booking');
  const details = encodeURIComponent(
    `WorkHub booking ${booking._id}\n${booking.Snapshot?.Address || ''}`
  );
  const location = encodeURIComponent(booking.Snapshot?.Address || '');
  const start = new Date(booking.StartTime);
  const end = new Date(booking.EndTime);
  const gFmt = (d) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gFmt(start)}/${gFmt(end)}&details=${details}&location=${location}`;
  // Outlook web
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${title}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${details}&location=${location}`;
  return { google, outlook, icsPath: `/api/me/bookings/${booking._id}/ics` };
}

module.exports = { getHostCalendar, bookingToIcs, calendarDeepLinks };
