import { InvalidTargetError, ValidationError } from "../shared/errors.js";
import { finiteNumber, percentage } from "../shared/numbers.js";
import { isInPeriod } from "../shared/dates.js";
import { aggregateLogsUnique, totalDuration, totalQuantity } from "./logs.js";
import { analyzeResultValues, choiceAnalyticalValue, normalizeResultConfig } from "./results.js";
import { isActionCompletionAchieved } from "./actions.js";
import { getDescendantBlockIds } from "./relationships.js";

export const TARGET_MODES = ["accumulation", "outcome"];
export const TARGET_METRICS = ["time", "quantity", "completion_count"];
export const COMPARISONS = [">=", ">", "=", "<=", "<"];

export function compareValues(actual, operator, expected) {
  if (operator === ">=") return actual >= expected; if (operator === ">") return actual > expected; if (operator === "=") return actual === expected; if (operator === "<=") return actual <= expected; if (operator === "<") return actual < expected; throw new InvalidTargetError("Unknown Target comparison.");
}

export function createTargetConfig({ mode = "accumulation", metric = "time", targetValue = 0, targetOptionId = null, sourceActionIds = [], sourceBlockId = null, descendantBlockIds = [], sourceResultFieldId = null, aggregation = "latest", comparison = ">=", unitId = null, contributionScope = "direct", requiredChildTargetIds = [], period = "day", periodStyle = "calendar", rollingWindowDays = null, customStart = null, customEnd = null, timezone = "UTC", weekStartsOn = 1 } = {}) {
  if (!TARGET_MODES.includes(mode)) throw new InvalidTargetError("Target mode is invalid.");
  if (mode === "accumulation" && !TARGET_METRICS.includes(metric)) throw new InvalidTargetError("Target metric is invalid.");
  if (mode === "accumulation" && Number(targetValue) < 0) throw new InvalidTargetError("Accumulation Targets cannot be negative.");
  if (mode === "outcome" && !["latest", "highest", "lowest", "average"].includes(aggregation)) throw new InvalidTargetError("Outcome aggregation is invalid.");
  if (!COMPARISONS.includes(comparison)) throw new InvalidTargetError("Target comparison is invalid.");
  if (!["session", "day", "week", "month", "custom", "all_time"].includes(period) && !/^rolling[_-]?\d+[_-]?days?$/i.test(String(period))) throw new InvalidTargetError("Target period is invalid.");
  if (!["calendar", "rolling"].includes(periodStyle)) throw new InvalidTargetError("Target period style is invalid.");
  if (periodStyle === "rolling" && (!Number.isInteger(Number(rollingWindowDays)) || Number(rollingWindowDays) < 1)) throw new InvalidTargetError("Rolling Targets require a positive window length.");
  if (period === "custom" && (!customStart || !customEnd || new Date(customStart) >= new Date(customEnd))) throw new InvalidTargetError("Custom Target periods require valid start and end dates.");
  const scope = ["inclusive", "inclusive_unique", "inclusive_descendants"].includes(contributionScope) ? contributionScope : "direct";
  return { mode, metric, targetValue: typeof targetValue === "string" ? targetValue : finiteNumber(targetValue), targetOptionId, sourceActionIds: [...new Set(sourceActionIds)], sourceBlockId, descendantBlockIds: [...new Set(descendantBlockIds)], sourceResultFieldId, aggregation, comparison, unitId, contributionScope: scope, requiredChildTargetIds: [...new Set(requiredChildTargetIds)], period, periodStyle, rollingWindowDays: rollingWindowDays == null ? null : Number(rollingWindowDays), customStart: customStart ? new Date(customStart).toISOString() : null, customEnd: customEnd ? new Date(customEnd).toISOString() : null, timezone, weekStartsOn };
}

export function filterTargetLogs({ logs = [], period = null, actionIds = [], blockId = null, blocks = [], contributionScope = "direct", descendantBlockIds = [] } = {}) {
  const ids = new Set(actionIds); const inclusive = ["inclusive", "inclusive_unique", "inclusive_descendants"].includes(contributionScope);
  const derivedDescendants = blockId && inclusive && blocks.length ? getDescendantBlockIds(blockId, blocks) : [];
  const blockIds = blockId && inclusive ? new Set([blockId, ...descendantBlockIds, ...derivedDescendants]) : blockId ? new Set([blockId]) : null;
  const referencesBlock = (log) => (log.contextRefs || []).some((reference) => blockIds?.has(reference.blockId || reference.blockIdRef || reference));
  return aggregateLogsUnique(logs, (log) => (!period || isInPeriod(log.eventAt, period)) && (!ids.size || ids.has(log.actionId)) && (!blockIds || referencesBlock(log)));
}

export function calculateTargetProgress({ target, logs = [], period = null, actions = [], blocks = [], resultField = null, units = [], childResults = [] } = {}) {
  let config = target?.config || target; if (!config) throw new InvalidTargetError("Target configuration is missing.");
  const selected = filterTargetLogs({ logs, period, actionIds: config.sourceActionIds || [], blockId: config.sourceBlockId || null, blocks, contributionScope: config.contributionScope || "direct", descendantBlockIds: config.descendantBlockIds || [] });
  let actual = 0; let analysis = null;
  if (config.mode === "accumulation") {
    if (config.metric === "time") actual = totalDuration(selected);
    else if (config.metric === "quantity") actual = totalQuantity(selected);
    else actual = selected.filter((log) => { const action = actions.find((candidate) => candidate.id === log.actionId); return action ? isActionCompletionAchieved({ action, log }) : Boolean(log.completed); }).length;
  } else {
    if (!resultField) throw new InvalidTargetError("Outcome Target requires a source Result Field.");
    const values = selected.flatMap((log) => (log.resultValues || []).filter((entry) => entry.fieldId === resultField.id).map((entry) => resultField.type === "measurement" ? entry : entry.value));
    analysis = analyzeResultValues({ field: resultField, values, units, operation: config.aggregation, targetUnitId: config.unitId || null });
    actual = analysis.value;
    if (resultField.type === "choice" && actual != null) {
      const targetOption = config.targetOptionId || config.targetValue;
      if (!normalizeResultConfig(resultField).orderMatters && config.comparison !== "=") throw new InvalidTargetError("Unordered Choice Targets only support equality.");
      if (config.comparison !== "=" && normalizeResultConfig(resultField).betterDirection === "none") throw new InvalidTargetError("Ordered Choice Targets need an explicit better direction for relational comparisons.");
      const actualScore = choiceAnalyticalValue(resultField, actual); const targetScore = choiceAnalyticalValue(resultField, targetOption);
      if (config.comparison !== "=" && actualScore != null && targetScore != null) { actual = actualScore; config = { ...config, targetValue: targetScore }; }
      else if (config.comparison === "=") { const actualValues = Array.isArray(actual) ? [...actual].sort() : [actual]; const targetValues = Array.isArray(targetOption) ? [...targetOption].sort() : [targetOption]; const reached = actualValues.length === targetValues.length && actualValues.every((value, index) => value === targetValues[index]); const children = (config.requiredChildTargetIds || []).every((id) => childResults.find((child) => child.targetId === id)?.reached); return { targetId: target?.id || null, actual, targetValue: targetOption, percentage: reached ? 100 : 0, difference: null, reached: reached && children, ownReached: reached, childrenReached: children, status: reached && children ? "REACHED" : selected.length ? "IN_PROGRESS" : "NOT_STARTED", logs: selected, analysis }; }
    }
    if (resultField.type === "text" && config.comparison === "=") { const targetText = String(config.targetValue ?? ""); const ownReached = String(actual ?? "") === targetText; const childrenReached = (config.requiredChildTargetIds || []).every((id) => childResults.find((child) => child.targetId === id)?.reached); const reached = ownReached && childrenReached; return { targetId: target?.id || null, actual, targetValue: targetText, percentage: ownReached ? 100 : 0, difference: null, reached, ownReached, childrenReached, status: reached ? "REACHED" : selected.length ? "IN_PROGRESS" : "NOT_STARTED", logs: selected, analysis }; }
    if (typeof actual !== "number") actual = finiteNumber(actual, 0);
  }
  const hasActual = selected.length > 0 && actual !== null && actual !== undefined && Number.isFinite(Number(actual));
  const reachedOwn = hasActual && compareValues(actual, config.comparison || ">=", finiteNumber(config.targetValue, 0));
  const childrenReached = (config.requiredChildTargetIds || []).every((id) => childResults.find((child) => child.targetId === id)?.reached);
  const reached = reachedOwn && childrenReached;
  const targetValue = finiteNumber(config.targetValue, 0);
  const overTarget = config.mode === "accumulation" && typeof actual === "number" && targetValue >= 0 && actual > targetValue;
  return { targetId: target?.id || null, actual, targetValue, percentage: config.mode === "accumulation" && targetValue === 0 ? (actual > 0 ? Infinity : 0) : percentage(actual, targetValue), difference: actual - targetValue, reached, ownReached: reachedOwn, childrenReached, status: reached ? (overTarget ? "OVER_TARGET" : "REACHED") : selected.length ? "IN_PROGRESS" : "NOT_STARTED", logs: selected, analysis };
}

export function evaluateTargetPeriod(args) { return calculateTargetProgress(args); }
