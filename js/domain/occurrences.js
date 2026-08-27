import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { finiteNumber } from "../shared/numbers.js";
import { isActionCompletionAchieved } from "./actions.js";

export const OCCURRENCE_STATUSES = ["upcoming", "available", "due", "overdue", "completed", "partial", "skipped", "missed", "expired", "paused", "excused", "not_applicable"];

export function createOccurrence({ id = null, relationshipId, scheduledAt = null, availableFrom = null, deadline = null, status = "upcoming", snapshot = {}, logIds = [], now = new Date() } = {}) {
  if (!relationshipId) throw new ValidationError("Occurrence requires a relationship.");
  if (!OCCURRENCE_STATUSES.includes(status)) throw new ValidationError("Occurrence status is invalid.");
  return { id: id || createId("occurrence", now), relationshipId, scheduledAt, availableFrom, deadline, status, snapshot: clone(snapshot) || {}, logIds: [...new Set(logIds)], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}

export function aggregateOccurrenceProgress({ occurrence, logs = [], action = null } = {}) {
  const selected = logs.filter((log) => occurrence?.logIds?.includes(log.id) || log.contextRefs?.some((ref) => ref.occurrenceId === occurrence?.id));
  return { logIds: [...new Set(selected.map((log) => log.id))], durationMinutes: selected.reduce((sum, log) => sum + finiteNumber(log.durationMinutes), 0), quantity: selected.reduce((sum, log) => sum + finiteNumber(log.quantity), 0), completed: action ? selected.some((log) => isActionCompletionAchieved({ action, log })) : false };
}

export function resolveOccurrenceStatus({ occurrence, logs = [], action = null, now = new Date(), unfinishedPolicy = "expire" } = {}) {
  if (["completed", "skipped", "excused", "not_applicable"].includes(occurrence.status)) return occurrence.status;
  const progress = aggregateOccurrenceProgress({ occurrence, logs, action });
  if (progress.completed) return "completed";
  const available = !occurrence.availableFrom || new Date(now) >= new Date(occurrence.availableFrom);
  const deadlinePassed = occurrence.deadline && new Date(now) >= new Date(occurrence.deadline);
  if (deadlinePassed) return unfinishedPolicy === "carry_forward" ? "overdue" : unfinishedPolicy === "stay_overdue" ? "overdue" : progress.logIds.length ? "partial" : "missed";
  return available ? (progress.logIds.length ? "partial" : "due") : "upcoming";
}
