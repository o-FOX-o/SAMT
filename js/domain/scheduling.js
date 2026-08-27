import { InvalidScheduleError } from "../shared/errors.js";
import { addCalendarDays, partsInTimeZone } from "../shared/dates.js";

export function occurrenceIdentity({ relationshipId, scheduledAt, sequence = 0 } = {}) { return `${relationshipId}:${scheduledAt || "manual"}:${sequence}`; }

export function isScheduleDue({ schedule = {}, at, timezone = "UTC" } = {}) {
  const mode = schedule.mode || "manual"; if (mode === "always_available" || mode === "manual") return mode === "always_available";
  if (mode === "once") return !schedule.date || String(schedule.date) === localDate(at, timezone);
  if (mode === "calendar") { const date = localDate(at, timezone); if (schedule.startDate && date < schedule.startDate || schedule.endDate && date > schedule.endDate) return false; if (schedule.calendarKind === "daily") return true; if (schedule.calendarKind === "dates") return (schedule.dates || []).includes(date); if (schedule.calendarKind === "weekdays") { const p = partsInTimeZone(at, timezone); return (schedule.weekdays || []).includes(new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()); } if (schedule.calendarKind === "monthly") return Number(schedule.dayOfMonth) === partsInTimeZone(at, timezone).day; if (schedule.calendarKind === "yearly") { const p = partsInTimeZone(at, timezone); return `${p.month}-${p.day}` === `${schedule.month}-${schedule.day}`; } return false; }
  if (mode === "interval") return Boolean(schedule.anchorAt) && new Date(at) >= new Date(schedule.anchorAt) && ((new Date(at) - new Date(schedule.anchorAt)) / 86400000) >= Number(schedule.every || 1);
  throw new InvalidScheduleError("Unknown schedule mode.");
}

function localDate(value, timezone) { const p = partsInTimeZone(value, timezone); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }

export function nextScheduledDate({ from, schedule = {}, timezone = "UTC" } = {}) {
  for (let i = 0; i < 3700; i += 1) { const candidate = addCalendarDays(from, i || 1, timezone); if (isScheduleDue({ schedule, at: candidate, timezone })) return candidate.toISOString(); }
  return null;
}
