import { InvalidTargetError, ValidationError } from "../shared/errors.js";
import { finiteNumber, percentage } from "../shared/numbers.js";
import { isInPeriod } from "../shared/dates.js";
import { aggregateLogsUnique, totalDuration, totalQuantity } from "./logs.js";
import { analyzeResultValues, normalizeResultConfig } from "./results.js";
import { convertValue, unitMap } from "./units.js";

export const TARGET_MODES = ["accumulation", "outcome"];
export const TARGET_METRICS = ["time", "quantity", "completion_count"];
export const COMPARISONS = [">=", ">", "=", "<=", "<"];

export function compareValues(actual, operator, expected) {
  if (operator === ">=") return actual >= expected; if (operator === ">") return actual > expected; if (operator === "=") return actual === expected; if (operator === "<=") return actual <= expected; if (operator === "<") return actual < expected; throw new InvalidTargetError("Unknown Target comparison.");
}

export function createTargetConfig({ mode = "accumulation", metric = "time", targetValue = 0, sourceActionIds = [], sourceResultFieldId = null, aggregation = "latest", comparison = ">=", unitId = null, contributionScope = "direct", requiredChildTargetIds = [], period = "day", periodStyle = "calendar", timezone = "UTC", weekStartsOn = 1 } = {}) {
  if (!TARGET_MODES.includes(mode)) throw new InvalidTargetError("Target mode is invalid.");
  if (mode === "accumulation" && !TARGET_METRICS.includes(metric)) throw new InvalidTargetError("Target metric is invalid.");
  if (mode === "outcome" && !["latest", "highest", "lowest", "average"].includes(aggregation)) throw new InvalidTargetError("Outcome aggregation is invalid.");
  if (!COMPARISONS.includes(comparison)) throw new InvalidTargetError("Target comparison is invalid.");
  return { mode, metric, targetValue: finiteNumber(targetValue), sourceActionIds: [...new Set(sourceActionIds)], sourceResultFieldId, aggregation, comparison, unitId, contributionScope: contributionScope === "inclusive" ? "inclusive" : "direct", requiredChildTargetIds: [...new Set(requiredChildTargetIds)], period, periodStyle, timezone, weekStartsOn };
}

export function filterTargetLogs({ logs = [], period = null, actionIds = [] } = {}) {
  const ids = new Set(actionIds); return aggregateLogsUnique(logs, (log) => (!period || isInPeriod(log.eventAt, period)) && (!ids.size || ids.has(log.actionId)));
}

export function calculateTargetProgress({ target, logs = [], period = null, actions = [], resultField = null, units = [], childResults = [] } = {}) {
  const config = target?.config || target; if (!config) throw new InvalidTargetError("Target configuration is missing.");
  const selected = filterTargetLogs({ logs, period, actionIds: config.sourceActionIds || [] });
  let actual = 0; let analysis = null;
  if (config.mode === "accumulation") {
    if (config.metric === "time") actual = totalDuration(selected);
    else if (config.metric === "quantity") actual = totalQuantity(selected);
    else actual = selected.filter((log) => actions.find((action) => action.id === log.actionId) ? true : Boolean(log.completed)).length;
  } else {
    if (!resultField) throw new InvalidTargetError("Outcome Target requires a source Result Field.");
    const values = selected.flatMap((log) => (log.resultValues || []).filter((entry) => entry.fieldId === resultField.id).map((entry) => entry.value));
    analysis = analyzeResultValues({ field: resultField, values, units, operation: config.aggregation, targetUnitId: config.unitId || null });
    actual = analysis.value;
    if (typeof actual !== "number") actual = finiteNumber(actual, 0);
  }
  const reachedOwn = compareValues(actual, config.comparison || ">=", finiteNumber(config.targetValue, 0));
  const childrenReached = (config.requiredChildTargetIds || []).every((id) => childResults.find((child) => child.targetId === id)?.reached);
  const reached = reachedOwn && childrenReached;
  const targetValue = finiteNumber(config.targetValue, 0);
  return { targetId: target?.id || null, actual, targetValue, percentage: config.mode === "accumulation" && targetValue === 0 ? (actual > 0 ? Infinity : 100) : percentage(actual, targetValue), difference: actual - targetValue, reached, ownReached: reachedOwn, childrenReached, status: reached ? "REACHED" : selected.length ? "IN_PROGRESS" : "NOT_STARTED", logs: selected, analysis };
}

export function evaluateTargetPeriod(args) { return calculateTargetProgress(args); }
