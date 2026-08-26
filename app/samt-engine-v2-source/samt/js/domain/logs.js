import { withinBounds } from "../shared/dates.js";

export function uniqueLogs(logs) {
  const seen = new Set();
  return (logs || []).filter((log) => {
    if (!log || !log.id || seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });
}

export function filterLogs(logs, { actionIds, bounds } = {}) {
  const ids = actionIds ? new Set(actionIds) : null;
  return uniqueLogs(logs).filter((log) => (!ids || ids.has(log.actionId)) && (!bounds || withinBounds(log.timestamp || log.createdAt, bounds)));
}

export function logMetricValue(log, metric) {
  if (metric === "time") return Number(log.durationPerformed ?? log.durationMinutes ?? log.duration ?? 0) || 0;
  if (metric === "quantity") return Number(log.quantityPerformed ?? log.quantity ?? log.amount ?? 0) || 0;
  if (metric === "count") return 1;
  if (metric === "completion_count") {
    if (Number(log.completionCount || 0) > 0) return 1;
    const actual = log.completionMethodSnapshot === "time" ? Number(log.durationPerformed ?? log.durationMinutes ?? 0) : Number(log.quantityPerformed ?? log.quantity ?? 0);
    const target = Number(log.completionTargetSnapshot || (log.completionMethodSnapshot === "quantity" ? 1 : 0));
    return actual > 0 && (target === 0 || actual >= target) ? 1 : 0;
  }
  return 0;
}

export function aggregateLogsUnique(logs, { metric = "time", actionIds, bounds } = {}) {
  const selected = filterLogs(logs, { actionIds, bounds });
  return {
    actual: selected.reduce((sum, log) => sum + logMetricValue(log, metric), 0),
    logIds: selected.map((log) => log.id),
    count: selected.length
  };
}

export function globalUniqueTime(logs, bounds) {
  return aggregateLogsUnique(logs, { metric: "time", bounds }).actual;
}
