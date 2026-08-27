import { InvalidScheduleError } from "../shared/errors.js";
import { addCalendarDays, partsInTimeZone } from "../shared/dates.js";

export function occurrenceIdentity({ relationshipId, scheduledAt, sequence = 0 } = {}) { return `${relationshipId}:${scheduledAt || "manual"}:${sequence}`; }

export function isScheduleDue({ schedule = {}, at, timezone = "UTC" } = {}) {
  const mode = schedule.mode || "manual"; if (mode === "always_available" || mode === "manual") return mode === "always_available";
  const date = localDate(at, timezone);
  if (mode === "once") return Boolean(schedule.date || schedule.anchorAt) && String(schedule.date || localDate(schedule.anchorAt, timezone)) === date;
  if (mode === "calendar") { if (schedule.startDate && date < schedule.startDate || schedule.endDate && date > schedule.endDate) return false; if (schedule.calendarKind === "daily") return true; if (schedule.calendarKind === "dates") return (schedule.dates || []).includes(date); if (schedule.calendarKind === "weekdays") { const p = partsInTimeZone(at, timezone); return (schedule.weekdays || []).includes(new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()); } if (schedule.calendarKind === "monthly") return Number(schedule.dayOfMonth) === partsInTimeZone(at, timezone).day; if (schedule.calendarKind === "yearly") { const p = partsInTimeZone(at, timezone); return Number(schedule.month) === p.month && Number(schedule.day) === p.day; } return false; }
  if (mode === "interval") {
    if (!schedule.anchorAt) return false;
    const start = new Date(schedule.anchorAt); const current = new Date(at); if (!Number.isFinite(start.getTime()) || current < start) return false;
    const every = Math.max(1, Number(schedule.every) || 1); const unit = schedule.unit || "days";
    if (unit === "hours") return Math.floor((current - start) / 3600000) >= every;
    if (unit === "weeks") return Math.floor((current - start) / 86400000) >= every * 7;
    if (unit === "months") { const a = partsInTimeZone(start, timezone); const b = partsInTimeZone(current, timezone); return (b.year - a.year) * 12 + b.month - a.month >= every; }
    return Math.floor((current - start) / 86400000) >= every;
  }
  throw new InvalidScheduleError("Unknown schedule mode.");
}

function localDate(value, timezone) { const p = partsInTimeZone(value, timezone); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }

export function nextScheduledDate({ from, schedule = {}, timezone = "UTC" } = {}) {
  const unit = schedule.unit || "days"; const step = unit === "hours" ? 3600000 : 86400000;
  for (let i = 1; i <= (unit === "hours" ? 100000 : 3700); i += 1) { const candidate = unit === "hours" ? new Date(new Date(from).getTime() + step * i) : addCalendarDays(from, i, timezone); if (isScheduleDue({ schedule, at: candidate, timezone })) return candidate.toISOString(); }
  return null;
}
