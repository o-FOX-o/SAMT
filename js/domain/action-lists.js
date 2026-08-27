import { InvalidScheduleError } from "../shared/errors.js";
import { createOccurrence } from "./occurrences.js";

export const SCHEDULE_MODES = ["always_available", "once", "interval", "calendar", "manual"];

const TERMINAL_OCCURRENCE_STATES = ["completed", "skipped", "missed", "expired", "excused", "not_applicable"];

export function validateActionListSchedule(schedule = {}) {
  if (!SCHEDULE_MODES.includes(schedule.mode || "manual")) throw new InvalidScheduleError("Action List schedule mode is invalid.");
  if (schedule.mode === "interval") {
    if (!Number.isInteger(Number(schedule.every)) || Number(schedule.every) < 1) throw new InvalidScheduleError("Interval schedules require a positive interval.");
    if (!["hours", "days", "weeks", "months"].includes(schedule.unit || "days")) throw new InvalidScheduleError("Interval unit is invalid.");
    if (schedule.anchor && !["fixed", "previous_occurrence", "previous_completion"].includes(schedule.anchor)) throw new InvalidScheduleError("Interval anchor is invalid.");
    if ((schedule.anchor || "fixed") === "fixed" && schedule.anchorAt && !Number.isFinite(new Date(schedule.anchorAt).getTime())) throw new InvalidScheduleError("Interval anchor time is invalid.");
  }
  if (schedule.mode === "once" && !schedule.date && !schedule.anchorAt) throw new InvalidScheduleError("Once schedules require a date or anchor.");
  if (schedule.mode === "calendar") {
    if (!["daily", "weekdays", "monthly", "yearly", "dates"].includes(schedule.calendarKind)) throw new InvalidScheduleError("Calendar schedule is invalid.");
    if (schedule.calendarKind === "weekdays" && (!Array.isArray(schedule.weekdays) || schedule.weekdays.some((day) => !Number.isInteger(Number(day)) || Number(day) < 0 || Number(day) > 6))) throw new InvalidScheduleError("Calendar weekdays are invalid.");
    if (schedule.calendarKind === "dates" && (!Array.isArray(schedule.dates) || schedule.dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))) throw new InvalidScheduleError("Calendar dates are invalid.");
    if (schedule.calendarKind === "monthly" && (!Number.isInteger(Number(schedule.dayOfMonth)) || Number(schedule.dayOfMonth) < 1 || Number(schedule.dayOfMonth) > 31)) throw new InvalidScheduleError("Calendar day of month is invalid.");
    if (schedule.calendarKind === "yearly" && (!Number.isInteger(Number(schedule.month)) || Number(schedule.month) < 1 || Number(schedule.month) > 12 || !Number.isInteger(Number(schedule.dayOfMonth || schedule.day)) || Number(schedule.dayOfMonth || schedule.day) < 1 || Number(schedule.dayOfMonth || schedule.day) > 31)) throw new InvalidScheduleError("Calendar yearly date is invalid.");
  }
  if (schedule.overlap && !["keep_each", "single_outstanding", "replace_previous"].includes(schedule.overlap)) throw new InvalidScheduleError("Recurring overlap policy is invalid.");
  if (schedule.unfinishedPolicy && !["expire", "carry_forward", "stay_overdue"].includes(schedule.unfinishedPolicy)) throw new InvalidScheduleError("Unfinished policy is invalid.");
  if (schedule.repeatEnd && !["never", "until_date", "after_occurrences", "after_completed_occurrences"].includes(schedule.repeatEnd)) throw new InvalidScheduleError("Repeat end policy is invalid.");
  if (schedule.untilDate && !/^\d{4}-\d{2}-\d{2}/.test(String(schedule.untilDate))) throw new InvalidScheduleError("Repeat end date is invalid.");
  if (schedule.maxOccurrences != null && (!Number.isInteger(Number(schedule.maxOccurrences)) || Number(schedule.maxOccurrences) < 1)) throw new InvalidScheduleError("Repeat occurrence limit is invalid.");
  return true;
}

export function createActionListOccurrence({ relationship, scheduledAt, availableFrom = null, deadline = null, snapshot = {}, now = new Date() } = {}) {
  validateActionListSchedule(relationship?.config?.schedule || { mode: "manual" });
  return createOccurrence({ relationshipId: relationship.id, scheduledAt, availableFrom, deadline, snapshot: { ...snapshot, schedule: relationship.config.schedule }, now });
}

export function resolveUnfinishedPolicy({ occurrence, policy = "expire", hasProgress = false } = {}) { return policy === "carry_forward" ? "overdue" : policy === "stay_overdue" ? "overdue" : hasProgress ? "partial" : "missed"; }

export function isScheduleEnded({ schedule = {}, now = new Date(), existingOccurrences = [] } = {}) {
  if (schedule.repeatEnd === "until_date" && schedule.untilDate) {
    const end = new Date(schedule.untilDate);
    if (Number.isFinite(end.getTime()) && new Date(now) >= end) return true;
  }
  const rows = existingOccurrences.filter((occurrence) => occurrence.relationshipId === schedule.relationshipId || !schedule.relationshipId);
  if (schedule.repeatEnd === "after_occurrences" && Number(schedule.maxOccurrences) > 0 && rows.length >= Number(schedule.maxOccurrences)) return true;
  if (schedule.repeatEnd === "after_completed_occurrences" && Number(schedule.maxOccurrences) > 0 && rows.filter((occurrence) => occurrence.status === "completed").length >= Number(schedule.maxOccurrences)) return true;
  return false;
}

export function shouldGenerateScheduledOccurrence({ schedule = {}, existingOccurrences = [], relationshipId, now = new Date() } = {}) {
  validateActionListSchedule(schedule);
  if (schedule.paused) return false;
  if (isScheduleEnded({ schedule: { ...schedule, relationshipId }, now, existingOccurrences })) return false;
  const outstanding = existingOccurrences.filter((occurrence) => occurrence.relationshipId === relationshipId && !TERMINAL_OCCURRENCE_STATES.includes(occurrence.status));
  if (schedule.overlap === "single_outstanding" && outstanding.length) return false;
  // Replace-previous deliberately permits a new occurrence. The lifecycle
  // layer marks the old outstanding occurrence as replaced/expired so the
  // generated record remains the sole current item without rewriting history.
  return true;
}
