"use strict";

const Booking = require("../models/Booking");
const Blackout = require("../models/Blackout");
const env = require("../config/env");
const { ACTIVE_STATUSES } = require("./bookingService");

/**
 * Suggest alternative start times when preferred slot is full.
 */
async function suggestAlternativeSlots({
  spaceId,
  startTime,
  endTime,
  max = 6,
  stepMinutes = null,
}) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMs = end - start;
  if (!(durationMs > 0)) return [];

  const step = (stepMinutes || env.BOOKING_SLOT_MINUTES || 30) * 60 * 1000;
  const candidates = [];
  // Same day: push later by step
  for (let i = 1; i <= 12 && candidates.length < max; i++) {
    const s = new Date(start.getTime() + i * step);
    const e = new Date(s.getTime() + durationMs);
    candidates.push({ start: s, end: e });
  }
  // Next day same clock
  const nextDay = new Date(start.getTime() + 24 * 3600000);
  candidates.push({
    start: nextDay,
    end: new Date(nextDay.getTime() + durationMs),
  });
  // Day after
  const day2 = new Date(start.getTime() + 48 * 3600000);
  candidates.push({ start: day2, end: new Date(day2.getTime() + durationMs) });

  const free = [];
  for (const c of candidates) {
    if (c.start < new Date()) continue;
    const conflict = await Booking.findOne({
      SpaceID: spaceId,
      Status: { $in: ACTIVE_STATUSES },
      StartTime: { $lt: c.end },
      EndTime: { $gt: c.start },
    })
      .select("_id")
      .lean();
    if (conflict) continue;
    const blackout = await Blackout.findOne({
      SpaceID: spaceId,
      StartTime: { $lt: c.end },
      EndTime: { $gt: c.start },
    })
      .select("_id")
      .lean();
    if (blackout) continue;
    free.push({
      startTime: c.start.toISOString(),
      endTime: c.end.toISOString(),
      label: `${c.start.toLocaleString("vi-VN")} – ${c.end.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`,
    });
    if (free.length >= max) break;
  }
  return free;
}

module.exports = { suggestAlternativeSlots };
