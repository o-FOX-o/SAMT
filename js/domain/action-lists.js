import { InvalidScheduleError } from "../shared/errors.js";
import { createOccurrence } from "./occurrences.js";

export const SCHEDULE_MODES = ["always_available", "once", "interval", "calendar", "manual"];

export function validateActionListSchedule(schedule = {}) {
  if (!SCHEDULE_MODES.includes(schedule.mode || "manual")) throw new InvalidScheduleError("Action List schedule mode is invalid.");
  if (schedule.mode === "interval" && (!Number.isInteger(Number(schedule.every)) || Number(schedule.every) < 1)) throw new InvalidScheduleError("Interval schedules require a positive interval.");
  if (schedule.mode === "calendar" && !["daily", "weekdays", "monthly", "yearly", "dates"].includes(schedule.calendarKind)) throw new InvalidScheduleError("Calendar schedule is invalid.");
  return true;
}

export function createActionListOccurrence({ relationship, scheduledAt, availableFrom = null, deadline = null, snapshot = {}, now = new Date() } = {}) {
  validateActionListSchedule(relationship?.config?.schedule || { mode: "manual" });
  return createOccurrence({ relationshipId: relationship.id, scheduledAt, availableFrom, deadline, snapshot: { ...snapshot, schedule: relationship.config.schedule }, now });
}

export function resolveUnfinishedPolicy({ occurrence, policy = "expire", hasProgress = false } = {}) { return policy === "carry_forward" ? "overdue" : policy === "stay_overdue" ? "overdue" : hasProgress ? "partial" : "missed"; }
