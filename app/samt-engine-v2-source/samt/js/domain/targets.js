import { InvalidTargetError } from "../shared/errors.js";
import { calculatePeriodBounds } from "../shared/dates.js";
import { percentage } from "../shared/numbers.js";
import { aggregateLogsUnique } from "./logs.js";
import { getDescendantActionIds } from "./relationships.js";
import { validatePeriodDefinition } from "./periods.js";

export function normalizeTargetConfig(block) {
  const config = block.typeConfig || {};
  return {
    targetMetric: config.targetMetric || "time",
    targetValue: Number(config.targetValue),
    targetUnit: config.targetUnit || (config.targetMetric === "time" || !config.targetMetric ? "minutes" : null),
    period: typeof config.period === "string" ? { mode: config.period } : (config.period || { mode: "all_time" }),
    aggregation: config.aggregation || "inclusive_unique",
    requireChildTargets: Boolean(config.requireChildTargets),
    requiredChildBlockIds: Array.isArray(config.requiredChildBlockIds) ? config.requiredChildBlockIds : []
  };
}

export function validateTargetConfig(config) {
  if (!["time", "quantity", "completion_count"].includes(config.targetMetric)) throw new InvalidTargetError("Target metric is invalid.");
  if (!(Number(config.targetValue) > 0)) throw new InvalidTargetError("Target value must be greater than zero.");
  if (config.aggregation !== "inclusive_unique") throw new InvalidTargetError("Target aggregation must be inclusive_unique.");
  try { config.period = validatePeriodDefinition(config.period); }
  catch (error) { throw new InvalidTargetError(error.message, error.details); }
  return config;
}

function normalizeTargetSnapshot(input) {
  return {
    targetMetric: input.targetMetric || input.metric || "time",
    targetValue: Number(input.targetValue ?? input.value),
    targetUnit: input.targetUnit || input.unit || null,
    period: typeof input.period === "string" ? { mode: input.period } : (input.period || { mode: "all_time" }),
    aggregation: input.aggregation || "inclusive_unique",
    requireChildTargets: Boolean(input.requireChildTargets),
    requiredChildBlockIds: Array.isArray(input.requiredChildBlockIds) ? input.requiredChildBlockIds : []
  };
}

export function calculateTargetProgress({ state, block, now, timezone, bounds: suppliedBounds, direct = false, closed = false, childProgress = [], config: suppliedConfig = null, actionIds: suppliedActionIds = null }) {
  const activePeriod = [...(state.targetPeriods || [])].reverse().find((item) => item.blockId === block.id && !item.closedAt && item.lifecycleStatus !== "closed");
  const config = validateTargetConfig(suppliedConfig
    ? normalizeTargetSnapshot(suppliedConfig)
    : activePeriod?.targetSnapshot
      ? normalizeTargetSnapshot(activePeriod.targetSnapshot)
      : normalizeTargetConfig(block));
  const bounds = suppliedBounds || (activePeriod ? { start: activePeriod.periodStart, end: activePeriod.periodEnd, mode: config.period.mode || config.period } : calculatePeriodBounds(config.period, now, timezone));
  const actionIds = suppliedActionIds
    ? new Set(suppliedActionIds)
    : activePeriod?.actionIdsSnapshot && !direct
      ? new Set(activePeriod.actionIdsSnapshot)
      : getDescendantActionIds(state, block.id, direct);
  const aggregate = aggregateLogsUnique(state.actionLogs || [], { metric: config.targetMetric, actionIds, bounds });
  const ownReached = aggregate.actual >= config.targetValue;
  const requiredReached = !config.requireChildTargets || config.requiredChildBlockIds.every((id) => childProgress.find((item) => item.blockId === id)?.reached);
  const reached = ownReached && requiredReached;
  const over = Math.max(0, aggregate.actual - config.targetValue);
  const status = reached ? (over > 0 ? "over_target" : "target_reached") : closed ? "missed" : aggregate.actual > 0 ? "in_progress" : "not_started";
  return {
    blockId: block.id,
    metric: config.targetMetric,
    target: config.targetValue,
    actual: aggregate.actual,
    percentage: percentage(aggregate.actual, config.targetValue),
    remaining: Math.max(0, config.targetValue - aggregate.actual),
    over,
    reached,
    status,
    bounds,
    direct,
    logIds: aggregate.logIds
  };
}

export function calculateTargetDirectAndInclusive(input) {
  return {
    direct: calculateTargetProgress({ ...input, direct: true }),
    inclusive: calculateTargetProgress({ ...input, direct: false })
  };
}
