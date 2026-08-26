import { ValidationError } from "./errors.js";

const formatterCache = new Map();

function formatter(timezone) {
  if (!timezone) throw new ValidationError("An explicit timezone is required.");
  if (!formatterCache.has(timezone)) {
    formatterCache.set(timezone, new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }));
  }
  return formatterCache.get(timezone);
}

export function toInstant(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError("Invalid date/time.", { value });
  return date;
}

export function zonedParts(value, timezone) {
  const parts = formatter(timezone).formatToParts(toInstant(value));
  const output = {};
  for (const part of parts) if (part.type !== "literal") output[part.type] = Number(part.value);
  return { year: output.year, month: output.month, day: output.day, hour: output.hour, minute: output.minute, second: output.second };
}

export function zonedDateTimeToInstant(parts, timezone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
  let guess = desired;
  for (let index = 0; index < 5; index += 1) {
    const actualParts = zonedParts(new Date(guess), timezone);
    const actual = Date.UTC(actualParts.year, actualParts.month - 1, actualParts.day, actualParts.hour, actualParts.minute, actualParts.second, parts.millisecond || 0);
    const delta = desired - actual;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess);
}

export function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addCalendarMonths(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: Math.min(parts.day || 1, lastDay) };
}

export function calendarDateKey(value, timezone) {
  const parts = zonedParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localWeekday(value, timezone) {
  const parts = zonedParts(value, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function dayBounds(now, timezone) {
  const local = zonedParts(now, timezone);
  const startParts = { year: local.year, month: local.month, day: local.day };
  const endParts = addCalendarDays(startParts, 1);
  return { start: zonedDateTimeToInstant(startParts, timezone).toISOString(), end: zonedDateTimeToInstant(endParts, timezone).toISOString() };
}

function weekBounds(now, timezone, weekStart = 1) {
  const local = zonedParts(now, timezone);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const offset = (weekday - Number(weekStart) + 7) % 7;
  const startParts = addCalendarDays(local, -offset);
  const endParts = addCalendarDays(startParts, 7);
  return { start: zonedDateTimeToInstant(startParts, timezone).toISOString(), end: zonedDateTimeToInstant(endParts, timezone).toISOString() };
}

function monthBounds(now, timezone) {
  const local = zonedParts(now, timezone);
  const startParts = { year: local.year, month: local.month, day: 1 };
  const endParts = addCalendarMonths(startParts, 1);
  return { start: zonedDateTimeToInstant(startParts, timezone).toISOString(), end: zonedDateTimeToInstant(endParts, timezone).toISOString() };
}

function customBounds(period, now, timezone) {
  const amount = Math.max(1, Math.trunc(Number(period.amount) || 1));
  const unit = period.unit || "days";
  const anchorValue = period.anchor || period.anchorDate;
  const anchor = anchorValue ? toInstant(anchorValue) : zonedDateTimeToInstant({ year: 1970, month: 1, day: 1 }, timezone);
  const nowMs = toInstant(now).getTime();
  if (unit === "months") {
    let startParts = zonedParts(anchor, timezone);
    startParts = { year: startParts.year, month: startParts.month, day: startParts.day };
    while (true) {
      const nextParts = addCalendarMonths(startParts, amount);
      const next = zonedDateTimeToInstant(nextParts, timezone);
      if (next.getTime() > nowMs) return { start: zonedDateTimeToInstant(startParts, timezone).toISOString(), end: next.toISOString() };
      startParts = nextParts;
    }
  }
  const days = amount * (unit === "weeks" ? 7 : 1);
  const anchorParts = zonedParts(anchor, timezone);
  const localNow = zonedParts(now, timezone);
  const anchorDay = Date.UTC(anchorParts.year, anchorParts.month - 1, anchorParts.day);
  const nowDay = Date.UTC(localNow.year, localNow.month - 1, localNow.day);
  const elapsedDays = Math.floor((nowDay - anchorDay) / 86400000);
  const periodIndex = Math.floor(elapsedDays / days);
  const startParts = addCalendarDays(anchorParts, periodIndex * days);
  const endParts = addCalendarDays(startParts, days);
  return { start: zonedDateTimeToInstant(startParts, timezone).toISOString(), end: zonedDateTimeToInstant(endParts, timezone).toISOString() };
}

export function calculatePeriodBounds(periodInput, now, timezone) {
  const period = typeof periodInput === "string" ? { mode: periodInput } : (periodInput || { mode: "all_time" });
  const mode = period.mode || period.type || "all_time";
  if (mode === "all_time" || mode === "all") return { start: null, end: null, mode: "all_time" };
  if (mode === "session") return { start: period.sessionStart || toInstant(now).toISOString(), end: period.sessionEnd || null, mode };
  const bounds = mode === "day" ? dayBounds(now, timezone)
    : mode === "week" ? weekBounds(now, timezone, period.weekStart ?? 1)
      : mode === "month" ? monthBounds(now, timezone)
        : mode === "custom" ? customBounds(period, now, timezone)
          : null;
  if (!bounds) throw new ValidationError(`Unsupported period mode: ${mode}`);
  return { ...bounds, mode };
}

export function withinBounds(timestamp, bounds) {
  const value = toInstant(timestamp).getTime();
  const beforeEnd = !bounds.end || (bounds.endInclusive
    ? value <= toInstant(bounds.end).getTime()
    : value < toInstant(bounds.end).getTime());
  return (!bounds.start || value >= toInstant(bounds.start).getTime()) && beforeEnd;
}
