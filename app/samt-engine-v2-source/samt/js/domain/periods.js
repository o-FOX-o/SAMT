import { calculatePeriodBounds } from "../shared/dates.js";

export function openPeriodRecord({ id, block, bounds, targetSnapshot, now, kind = "target" }) {
  return { id, blockId: block.id, blockNameSnapshot: block.name, kind, periodStart: bounds.start, periodEnd: bounds.end, targetSnapshot, actual: 0, status: "open", actionLogIds: [], createdAt: now, updatedAt: now };
}

export function closePeriodRecord(record, evaluation, now) {
  return { ...record, actual: evaluation.actual, status: evaluation.status, lifecycleStatus: "closed", score: evaluation.score ?? null, failureLoad: evaluation.failureLoad ?? null, percentage: evaluation.percentage ?? null, actionLogIds: [...(evaluation.logIds || [])], closedAt: now, updatedAt: now };
}

export function currentPeriodBounds(block, now, timezone) {
  const period = block.direction === "avoid" ? block.typeConfig?.avoidEvaluation?.period : block.typeConfig?.period;
  return calculatePeriodBounds(period || { mode: "all_time" }, now, timezone);
}
