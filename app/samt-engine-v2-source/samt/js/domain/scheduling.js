import { InvalidScheduleError } from "../shared/errors.js";
import { calendarDateKey, calculatePeriodBounds, localWeekday, zonedParts } from "../shared/dates.js";

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
  const schedule = {
    mode,
    intervalMinutes: Number(input.intervalMinutes || (input.interval?.amount * ({ minutes: 1, hours: 60, days: 1440, weeks: 10080 }[input.interval?.unit] || 0)) || 0),
    weekdays: (Array.isArray(input.weekdays) ? input.weekdays : legacyCalendar.weekdays || []).map(Number),
    dates: Array.isArray(input.dates) ? input.dates : (legacyCalendar.dates || []),
    monthlyDay: input.monthlyDay == null ? Number(legacyCalendar.dayOfMonth || 1) : Number(input.monthlyDay),
    annualMonth: input.annualMonth == null ? Number(monthDay?.[1] || 1) : Number(input.annualMonth),
    annualDay: input.annualDay == null ? Number(monthDay?.[2] || 1) : Number(input.annualDay),
    annualWindowStart: input.annualWindowStart || legacyCalendar.windowStart || null,
    annualWindowEnd: input.annualWindowEnd || legacyCalendar.windowEnd || null,
    availableAt: input.availableAt || input.availableFrom?.at || null,
    time: input.time || legacyCalendar.time || "00:00",
    deadlineAt: input.deadlineAt || (deadline.mode === "absolute" ? deadline.at : null),
    deadlineMinutes: input.deadlineMinutes == null ? (deadline.mode === "relative" ? Number(deadline.amount || 1) * (unitMinutes[deadline.unit] || 1440) : null) : Number(input.deadlineMinutes),
    expiryPolicy: input.expiryPolicy || input.carryPolicy || input.unfinishedPolicy || "carry_forward"
  };
  if (!["always", "once", "interval", "daily", "weekdays", "specific_dates", "monthly", "annual", "annual_window"].includes(mode)) throw new InvalidScheduleError(`Unsupported schedule mode: ${mode}`);
  if (mode === "interval" && !(schedule.intervalMinutes > 0)) throw new InvalidScheduleError("Interval must be greater than zero.");
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
  const availableAt = schedule.mode === "interval" ? new Date(instant).toISOString() : schedule.availableAt && ["always", "once"].includes(schedule.mode) ? schedule.availableAt : bounds.start;
  const dueAt = schedule.deadlineAt || (schedule.deadlineMinutes == null ? (["always", "once"].includes(schedule.mode) ? null : bounds.end) : new Date(new Date(availableAt).getTime() + schedule.deadlineMinutes * 60000).toISOString());
  return { availableAt, dueAt, expiryPolicy: schedule.expiryPolicy };
}
