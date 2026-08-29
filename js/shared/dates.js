import { InvalidScheduleError } from "./errors.js";

const DAY_MS = 86400000;

export function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new InvalidScheduleError("Invalid date/time.");
  return date;
}

export function iso(value) { return asDate(value).toISOString(); }

export function partsInTimeZone(value, timezone = "UTC") {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function zonedPartsToUtc(parts, timezone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const actual = partsInTimeZone(new Date(guess), timezone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day,
      actual.hour || 0, actual.minute || 0, actual.second || 0);
    guess += target - actualAsUtc;
  }
  return new Date(guess);
}

export function startOfLocalDay(value, timezone = "UTC") {
  const p = partsInTimeZone(value, timezone);
  return zonedPartsToUtc({ year: p.year, month: p.month, day: p.day, hour: 0 }, timezone);
}

export function addCalendarDays(value, days, timezone = "UTC") {
  const p = partsInTimeZone(value, timezone);
  const noon = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
  noon.setUTCDate(noon.getUTCDate() + Number(days));
  return zonedPartsToUtc({
    year: noon.getUTCFullYear(), month: noon.getUTCMonth() + 1,
    day: noon.getUTCDate(), hour: p.hour, minute: p.minute, second: p.second
  }, timezone);
}

export function startOfLocalWeek(value, timezone = "UTC", weekStartsOn = 1) {
  const date = startOfLocalDay(value, timezone);
  const p = partsInTimeZone(date, timezone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const distance = (day - Number(weekStartsOn) + 7) % 7;
  return startOfLocalDay(addCalendarDays(date, -distance, timezone), timezone);
}

export function startOfLocalMonth(value, timezone = "UTC") {
  const p = partsInTimeZone(value, timezone);
  return zonedPartsToUtc({ year: p.year, month: p.month, day: 1, hour: 0 }, timezone);
}

export function calculatePeriodBounds({ period = "day", at, timezone = "UTC", weekStartsOn = 1,
  style = "calendar", rollingWindowDays = null, customStart = null, customEnd = null } = {}) {
  const current = asDate(at);
  const rollingMatch = String(period).match(/^rolling[_-]?(\d+)[_-]?days?$/i);
  if (rollingMatch) {
    const days = Math.max(1, Number(rollingMatch[1])); const end = current; const start = new Date(end.getTime() - days * DAY_MS);
    return { start: start.toISOString(), end: end.toISOString(), key: `rolling-${days}:${end.toISOString()}` };
  }
  if (style === "rolling" && ["day", "week", "month"].includes(period)) {
    const fallbackDays = period === "day" ? 1 : period === "week" ? 7 : 30;
    const days = Number.isInteger(Number(rollingWindowDays)) && Number(rollingWindowDays) > 0 ? Number(rollingWindowDays) : fallbackDays;
    const end = current; const start = new Date(end.getTime() - days * DAY_MS);
    return { start: start.toISOString(), end: end.toISOString(), key: `rolling-${days}:${end.toISOString()}` };
  }
  if (period === "session" || period === "all_time") return { start: null, end: null, key: period };
  if (period === "custom") {
    if (!customStart || !customEnd) throw new InvalidScheduleError("Custom periods require start and end.");
    const start = asDate(customStart); const end = asDate(customEnd);
    if (end <= start) throw new InvalidScheduleError("Custom period end must be after start.");
    return { start: start.toISOString(), end: end.toISOString(), key: `${start.toISOString()}..${end.toISOString()}` };
  }
  let start;
  if (period === "day") start = startOfLocalDay(current, timezone);
  else if (period === "week") start = startOfLocalWeek(current, timezone, weekStartsOn);
  else if (period === "month") start = startOfLocalMonth(current, timezone);
  else throw new InvalidScheduleError(`Unsupported period: ${period}`);
  const next = period === "day" ? addCalendarDays(start, 1, timezone)
    : period === "week" ? addCalendarDays(start, 7, timezone)
      : (() => { const p = partsInTimeZone(start, timezone); const n = new Date(Date.UTC(p.year, p.month, 1)); return zonedPartsToUtc({ year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: 1, hour: 0 }, timezone); })();
  return { start: start.toISOString(), end: next.toISOString(), key: start.toISOString() };
}

export function isInPeriod(value, period) {
  const time = asDate(value).getTime();
  const start = period.start ? asDate(period.start).getTime() : -Infinity;
  const end = period.end ? asDate(period.end).getTime() : Infinity;
  return time >= start && time < end;
}

export function daysBetween(left, right) {
  return Math.round((asDate(left).getTime() - asDate(right).getTime()) / DAY_MS);
}
