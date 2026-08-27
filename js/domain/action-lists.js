import { InvalidScheduleError } from "../shared/errors.js";
import { createOccurrence } from "./occurrences.js";

export const SCHEDULE_MODES = ["always_available", "once", "interval", "calendar", "manual"];

export function validateActionListSchedule(schedule = {}) {
  if (!SCHEDULE_MODES.includes(schedule.mode || "manual")) throw new InvalidScheduleError("Action List schedule mode is invalid.");
  if (schedule.mode === "interval") {
    if (!Number.isInteger(Number(schedule.every)) || Number(schedule.every) < 1) throw new InvalidScheduleError("Interval schedules require a positive interval.");
    if (!["hours", "days", "weeks", "months"].includes(schedule.unit || "days")) throw new InvalidScheduleError("Interval unit is invalid.");
    if (schedule.anchor && !["fixed", "previous_occurrence", "previous_completion"].includes(schedule.anchor)) throw new InvalidScheduleError("Interval anchor is invalid.");
  }
  if (schedule.mode === "once" && !schedule.date && !schedule.anchorAt) throw new InvalidScheduleError("Once schedules require a date or anchor.");
  if (schedule.mode === "calendar") {
    if (!["daily", "weekdays", "monthly", "yearly", "dates"].includes(schedule.calendarKind)) throw new InvalidScheduleError("Calendar schedule is invalid.");
    if (schedule.calendarKind === "weekdays" && (!Array.isArray(schedule.weekdays) || schedule.weekdays.some((day) => !Number.isInteger(Number(day)) || Number(day) < 0 || Number(day) > 6))) throw new InvalidScheduleError("Calendar weekdays are invalid.");
    if (schedule.calendarKind === "dates" && (!Array.isArray(schedule.dates) || schedule.dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))) throw new InvalidScheduleError("Calendar dates are invalid.");
  }
  if (schedule.overlap && !["keep_each", "single_outstanding", "replace_previous"].includes(schedule.overlap)) throw new InvalidScheduleError("Recurring overlap policy is invalid.");
  if (schedule.unfinishedPolicy && !["expire", "carry_forward", "stay_overdue"].includes(schedule.unfinishedPolicy)) throw new InvalidScheduleError("Unfinished policy is invalid.");
  return true;
}

export function createActionListOccurrence({ relationship, scheduledAt, availableFrom = null, deadline = null, snapshot = {}, now = new Date() } = {}) {
  validateActionListSchedule(relationship?.config?.schedule || { mode: "manual" });
  return createOccurrence({ relationshipId: relationship.id, scheduledAt, availableFrom, deadline, snapshot: { ...snapshot, schedule: relationship.config.schedule }, now });
}

export function resolveUnfinishedPolicy({ occurrence, policy = "expire", hasProgress = false } = {}) { return policy === "carry_forward" ? "overdue" : policy === "stay_overdue" ? "overdue" : hasProgress ? "partial" : "missed"; }

export function shouldGenerateScheduledOccurrence({ schedule = {}, existingOccurrences = [], relationshipId, now = new Date() } = {}) {
  validateActionListSchedule(schedule);
  if (schedule.paused) return false;
  const outstanding = existingOccurrences.filter((occurrence) => occurrence.relationshipId === relationshipId && !["completed", "skipped", "missed", "expired"].includes(occurrence.status));
  if (schedule.overlap === "single_outstanding" && outstanding.length) return false;
  return schedule.overlap !== "replace_previous" || outstanding.length === 0;
}
