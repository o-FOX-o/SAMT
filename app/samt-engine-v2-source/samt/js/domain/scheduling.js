import { InvalidScheduleError } from "../shared/errors.js";
import { calendarDateKey, calculatePeriodBounds, localWeekday, zonedDateTimeToInstant, zonedParts } from "../shared/dates.js";

const SCHEDULE_MODES = ["always", "once", "interval", "daily", "weekdays", "specific_dates", "monthly", "annual", "annual_window"];
const EXPIRY_POLICIES = ["carry_forward", "expire"];

function validInstant(value) {
  return value == null || value === "" || Number.isFinite(Date.parse(value));
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function validMonthDay(value) {
  if (!/^\d{2}-\d{2}$/.test(String(value || ""))) return false;
  return validDateKey(`2000-${value}`);
}

function parseClock(value) {
  const match = String(value || "00:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new InvalidScheduleError("Schedule time must use HH:mm.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new InvalidScheduleError("Schedule time is outside the local day.");
  return { hour, minute, text: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function normalizeSchedule(input = {}) {
  const legacyCalendar = input.calendar || {};
  let mode = input.mode || input.scheduleMode || "always";
  if (mode === "calendar") {
    mode = legacyCalendar.mode === "weekdays" ? "weekdays"
      : ["specific", "selected_dates"].includes(legacyCalendar.mode) ? "specific_dates"
        : legacyCalendar.mode === "monthly" ? "monthly"
          : legacyCalendar.mode === "annual" ? "annual"
            : legacyCalendar.mode === "window" ? "annual_window"
              : "daily";
  }
  const monthDay = String(legacyCalendar.monthDay || "").match(/^(\d{2})-(\d{2})$/);
  const deadline = input.deadline || {};
  const unitMinutes = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };
  const expiryInput = input.expiryPolicy || input.carryPolicy || input.unfinishedPolicy || "carry_forward";
  const expiryPolicy = ["expire", "miss", "missed"].includes(expiryInput) ? "expire" : "carry_forward";
  const schedule = {
    mode,
    intervalMinutes: Number(input.intervalMinutes || (input.interval?.amount * ({ minutes: 1, hours: 60, days: 1440, weeks: 10080 }[input.interval?.unit] || 0)) || 0),
    weekdays: [...new Set((Array.isArray(input.weekdays) ? input.weekdays : legacyCalendar.weekdays || []).map(Number))],
    dates: [...new Set(Array.isArray(input.dates) ? input.dates : (legacyCalendar.dates || []))],
    monthlyDay: input.monthlyDay == null ? Number(legacyCalendar.dayOfMonth || 1) : Number(input.monthlyDay),
    annualMonth: input.annualMonth == null ? Number(monthDay?.[1] || 1) : Number(input.annualMonth),
    annualDay: input.annualDay == null ? Number(monthDay?.[2] || 1) : Number(input.annualDay),
    annualWindowStart: input.annualWindowStart || legacyCalendar.windowStart || null,
    annualWindowEnd: input.annualWindowEnd || legacyCalendar.windowEnd || null,
    availableAt: input.availableAt || input.availableFrom?.at || null,
    time: parseClock(input.time || legacyCalendar.time || "00:00").text,
    deadlineAt: input.deadlineAt || (deadline.mode === "absolute" ? deadline.at : null),
    deadlineMinutes: input.deadlineMinutes == null ? (deadline.mode === "relative" ? Number(deadline.amount || 1) * (unitMinutes[deadline.unit] || 1440) : null) : Number(input.deadlineMinutes),
    expiryPolicy
  };
  if (!SCHEDULE_MODES.includes(mode)) throw new InvalidScheduleError(`Unsupported schedule mode: ${mode}`);
  if (!EXPIRY_POLICIES.includes(schedule.expiryPolicy)) throw new InvalidScheduleError("Occurrence expiry policy is invalid.");
  if (mode === "interval" && !(schedule.intervalMinutes > 0)) throw new InvalidScheduleError("Interval must be greater than zero.");
  if (schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new InvalidScheduleError("Weekdays must be integers from 0 to 6.");
  if (mode === "weekdays" && !schedule.weekdays.length) throw new InvalidScheduleError("A weekday schedule needs at least one weekday.");
  if (schedule.dates.some((date) => !validDateKey(date))) throw new InvalidScheduleError("A specific schedule date is invalid.");
  if (mode === "specific_dates" && !schedule.dates.length) throw new InvalidScheduleError("A specific-date schedule needs at least one date.");
  if (!Number.isInteger(schedule.monthlyDay) || schedule.monthlyDay < 1 || schedule.monthlyDay > 31) throw new InvalidScheduleError("Monthly day must be from 1 to 31.");
  if (!Number.isInteger(schedule.annualMonth) || schedule.annualMonth < 1 || schedule.annualMonth > 12 || !Number.isInteger(schedule.annualDay) || !validMonthDay(`${String(schedule.annualMonth).padStart(2, "0")}-${String(schedule.annualDay).padStart(2, "0")}`)) throw new InvalidScheduleError("Annual month and day are invalid.");
  if (mode === "annual_window" && (!validMonthDay(schedule.annualWindowStart) || !validMonthDay(schedule.annualWindowEnd))) throw new InvalidScheduleError("Annual window dates must use MM-DD.");
  if (!validInstant(schedule.availableAt) || !validInstant(schedule.deadlineAt)) throw new InvalidScheduleError("Schedule availability or deadline is invalid.");
  if (mode === "once" && !schedule.availableAt) throw new InvalidScheduleError("A one-time schedule needs an availability time.");
  if (schedule.deadlineMinutes != null && (!Number.isFinite(schedule.deadlineMinutes) || schedule.deadlineMinutes < 0)) throw new InvalidScheduleError("Relative deadline cannot be negative.");
  if (schedule.availableAt && schedule.deadlineAt && Date.parse(schedule.deadlineAt) < Date.parse(schedule.availableAt)) throw new InvalidScheduleError("Deadline cannot be before availability.");
  return schedule;
}

export function scheduleAppliesOnDate(scheduleInput, instant, timezone) {
  const schedule = normalizeSchedule(scheduleInput);
  const dateKey = calendarDateKey(instant, timezone);
  const parts = zonedParts(instant, timezone);
  if (["always", "interval"].includes(schedule.mode)) return true;
  if (schedule.mode === "once") return !schedule.availableAt || calendarDateKey(schedule.availableAt, timezone) === dateKey;
  if (schedule.mode === "daily") return true;
  if (schedule.mode === "weekdays") return schedule.weekdays.includes(localWeekday(instant, timezone));
  if (schedule.mode === "specific_dates") return schedule.dates.includes(dateKey);
  if (schedule.mode === "monthly") return parts.day === schedule.monthlyDay;
  if (schedule.mode === "annual") return parts.month === schedule.annualMonth && parts.day === schedule.annualDay;
  if (schedule.mode === "annual_window") {
    const current = `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    if (!schedule.annualWindowStart || !schedule.annualWindowEnd) return false;
    return schedule.annualWindowStart <= schedule.annualWindowEnd
      ? current >= schedule.annualWindowStart && current <= schedule.annualWindowEnd
      : current >= schedule.annualWindowStart || current <= schedule.annualWindowEnd;
  }
  return false;
}

export function occurrenceWindowForDate(scheduleInput, instant, timezone) {
  const schedule = normalizeSchedule(scheduleInput);
  const bounds = calculatePeriodBounds({ mode: "day" }, instant, timezone);
  const local = zonedParts(instant, timezone);
  const clock = parseClock(schedule.time);
  const recurringAt = zonedDateTimeToInstant({ year: local.year, month: local.month, day: local.day, hour: clock.hour, minute: clock.minute }, timezone).toISOString();
  const availableAt = schedule.mode === "interval"
    ? new Date(instant).toISOString()
    : schedule.availableAt && ["always", "once"].includes(schedule.mode)
      ? new Date(schedule.availableAt).toISOString()
      : recurringAt;
  const dueAt = schedule.deadlineAt || (schedule.deadlineMinutes == null ? (["always", "once"].includes(schedule.mode) ? null : bounds.end) : new Date(new Date(availableAt).getTime() + schedule.deadlineMinutes * 60000).toISOString());
  return { availableAt, dueAt, expiryPolicy: schedule.expiryPolicy };
}
