import { InvalidScheduleError } from "../shared/errors.js";

export const OPEN_OCCURRENCE_STATES = ["upcoming", "available", "due", "overdue", "partial", "paused"];
export const CLOSED_OCCURRENCE_STATES = ["completed", "skipped", "missed"];

export function resolveOccurrenceStatus(occurrence, now) {
  if (CLOSED_OCCURRENCE_STATES.includes(occurrence.status)) return occurrence.status;
  if (occurrence.status === "paused") return "paused";
  const time = new Date(now).getTime();
  const available = occurrence.availableAt ? new Date(occurrence.availableAt).getTime() : -Infinity;
  const due = occurrence.dueAt ? new Date(occurrence.dueAt).getTime() : Infinity;
  if (!Number.isFinite(time)) throw new InvalidScheduleError("Occurrence evaluation time is invalid.");
  if (time < available) return "upcoming";
  if (time >= due) return occurrence.expiryPolicy === "expire" ? "missed" : "overdue";
  if (Number(occurrence.actual || 0) > 0) return "partial";
  return occurrence.dueAt ? "due" : "available";
}

export function completeOccurrence(occurrence, now, status = "completed") {
  if (!CLOSED_OCCURRENCE_STATES.includes(status)) throw new InvalidScheduleError("Occurrence can only close as completed, skipped or missed.");
  return {
    ...occurrence,
    status,
    completedAt: status === "completed" ? now : occurrence.completedAt || null,
    skippedAt: status === "skipped" ? now : occurrence.skippedAt || null,
    missedAt: status === "missed" ? now : occurrence.missedAt || null,
    updatedAt: now
  };
}
