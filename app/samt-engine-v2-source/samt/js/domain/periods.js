import { calculatePeriodBounds } from "../shared/dates.js";
import { ValidationError } from "../shared/errors.js";

export const PERIOD_MODES = ["session", "day", "week", "month", "custom", "all_time"];

export function normalizePeriodDefinition(input = { mode: "all_time" }) {
  const period = typeof input === "string" ? { mode: input } : { ...(input || {}) };
  period.mode = period.mode || period.type || "all_time";
  if (period.mode === "all") period.mode = "all_time";
  if (period.weekStart != null) period.weekStart = Number(period.weekStart);
  if (period.amount != null) period.amount = Number(period.amount);
  return period;
}

export function validatePeriodDefinition(input) {
  const period = normalizePeriodDefinition(input);
  if (!PERIOD_MODES.includes(period.mode)) throw new ValidationError(`Unsupported period mode: ${period.mode}`);
  if (period.mode === "week" && period.weekStart != null && (!Number.isInteger(period.weekStart) || period.weekStart < 0 || period.weekStart > 6)) throw new ValidationError("Week start must be an integer from 0 to 6.");
  if (period.mode === "custom") {
    if (!Number.isInteger(period.amount) || period.amount < 1) throw new ValidationError("Custom period amount must be a whole number of at least 1.");
    if (!["days", "weeks", "months"].includes(period.unit)) throw new ValidationError("Custom period unit must be days, weeks or months.");
    if (period.anchor && !Number.isFinite(Date.parse(period.anchor))) throw new ValidationError("Custom period anchor is invalid.");
  }
  if (period.mode === "session" && period.sessionStart && !Number.isFinite(Date.parse(period.sessionStart))) throw new ValidationError("Session start is invalid.");
  return period;
}

export function openPeriodRecord({ id, block, bounds, targetSnapshot, now, kind = "target" }) {
  return { id, blockId: block.id, blockNameSnapshot: block.name, kind, periodStart: bounds.start, periodEnd: bounds.end, targetSnapshot, actual: 0, status: "open", lifecycleStatus: "open", actionLogIds: [], createdAt: now, updatedAt: now };
}

export function closePeriodRecord(record, evaluation, now) {
  return { ...record, actual: evaluation.actual, status: evaluation.status, lifecycleStatus: "closed", score: evaluation.score ?? null, failureLoad: evaluation.failureLoad ?? null, percentage: evaluation.percentage ?? null, actionLogIds: [...(evaluation.logIds || [])], closedAt: now, updatedAt: now };
}

export function currentPeriodBounds(block, now, timezone) {
  const period = block.direction === "avoid" ? block.typeConfig?.avoidEvaluation?.period : block.typeConfig?.period;
  return calculatePeriodBounds(validatePeriodDefinition(period || { mode: "all_time" }), now, timezone);
}
