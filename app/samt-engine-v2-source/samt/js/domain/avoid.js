import { InvalidAvoidEvaluationError } from "../shared/errors.js";
import { calculatePeriodBounds } from "../shared/dates.js";
import { round } from "../shared/numbers.js";
import { aggregateLogsUnique } from "./logs.js";
import { getDescendantActionIds } from "./relationships.js";

export function normalizeAvoidEvaluation(input = {}) {
  const mode = input.mode || "binary_limit";
  const metric = input.metric || "time";
  const anchors = Array.isArray(input.anchors) ? input.anchors.map((anchor) => ({ value: Number(anchor.value), score: Number(anchor.score) })).sort((a, b) => a.value - b.value) : [];
  return {
    mode,
    metric,
    period: typeof input.period === "string" ? { mode: input.period } : (input.period || { mode: "day" }),
    binaryLimit: Number(input.binaryLimit ?? 0),
    anchors,
    belowRange: input.belowRange || "clamp",
    aboveRange: input.aboveRange || "continue_slope",
    allowedCount: Number(input.allowedCount ?? 0),
    violationPenalty: Number(input.violationPenalty ?? 100),
    scope: input.scope || "aggregate",
    childOutcome: input.childOutcome || "any_required_failure",
    requiredChildBlockIds: Array.isArray(input.requiredChildBlockIds) ? input.requiredChildBlockIds : []
  };
}

export function validateAvoidEvaluation(input) {
  const config = normalizeAvoidEvaluation(input);
  if (!["binary_limit", "scored_range", "violation_multiplier"].includes(config.mode)) throw new InvalidAvoidEvaluationError("Avoid evaluation mode is invalid.");
  if (!["time", "count", "quantity"].includes(config.metric)) throw new InvalidAvoidEvaluationError("Avoid metric is invalid.");
  if (config.binaryLimit < 0 || config.allowedCount < 0) throw new InvalidAvoidEvaluationError("Avoid limits cannot be negative.");
  if (config.mode === "scored_range") {
    if (config.anchors.length < 2) throw new InvalidAvoidEvaluationError("Scored Range needs at least two anchors.");
    const values = new Set();
    for (const anchor of config.anchors) {
      if (anchor.value < 0 || !Number.isFinite(anchor.value) || !Number.isFinite(anchor.score)) throw new InvalidAvoidEvaluationError("Avoid score anchors are invalid.");
      if (values.has(anchor.value)) throw new InvalidAvoidEvaluationError("Avoid score anchors cannot share the same value.");
      values.add(anchor.value);
    }
  }
  if (config.mode === "violation_multiplier" && !(config.violationPenalty > 0)) throw new InvalidAvoidEvaluationError("Violation penalty must be greater than zero.");
  return config;
}

function lineValue(a, b, value) {
  if (b.value === a.value) return b.score;
  return a.score + ((value - a.value) / (b.value - a.value)) * (b.score - a.score);
}

export function interpolateAvoidScore(value, input) {
  const config = validateAvoidEvaluation({ ...input, mode: "scored_range" });
  const anchors = config.anchors;
  if (value <= anchors[0].value) return round(config.belowRange === "continue_slope" ? lineValue(anchors[0], anchors[1], value) : anchors[0].score, 4);
  for (let index = 1; index < anchors.length; index += 1) {
    if (value <= anchors[index].value) return round(lineValue(anchors[index - 1], anchors[index], value), 4);
  }
  const last = anchors[anchors.length - 1];
  return round(config.aboveRange === "continue_slope" ? lineValue(anchors[anchors.length - 2], last, value) : last.score, 4);
}

export function evaluateAvoidValue(actual, input) {
  const config = validateAvoidEvaluation(input);
  if (actual < 0) throw new InvalidAvoidEvaluationError("Avoid actual value cannot be negative.");
  if (config.mode === "binary_limit") {
    const passed = actual <= config.binaryLimit;
    return { mode: config.mode, actual, limit: config.binaryLimit, score: passed ? 100 : 0, failureLoad: passed ? 0 : 100, status: passed ? "success" : "failed", reachedFailure: !passed };
  }
  if (config.mode === "scored_range") {
    const score = interpolateAvoidScore(actual, config);
    return { mode: config.mode, actual, score, failureLoad: score < 0 ? Math.abs(score) : 0, status: score > 0 ? "success" : score === 0 ? "neutral" : "failed", reachedFailure: score < 0 };
  }
  const excess = Math.max(0, actual - config.allowedCount);
  const failureLoad = excess * config.violationPenalty;
  return { mode: config.mode, actual, allowedCount: config.allowedCount, score: excess === 0 ? 100 : null, failureLoad, status: excess === 0 ? "success" : "failed", reachedFailure: excess > 0 };
}

export function evaluateAvoidPeriod({ state, block, now, timezone, bounds: suppliedBounds }) {
  const config = validateAvoidEvaluation(block.typeConfig && block.typeConfig.avoidEvaluation || {});
  const activeSession = (config.period.mode || config.period) === "session" ? [...(state.avoidPeriods || [])].reverse().find((item) => item.blockId === block.id && !item.closedAt && !item.periodEnd) : null;
  const bounds = suppliedBounds || (activeSession ? { start: activeSession.periodStart, end: activeSession.periodEnd, mode: "session" } : calculatePeriodBounds(config.period, now, timezone));
  const actionIds = getDescendantActionIds(state, block.id, false);
  const aggregate = aggregateLogsUnique(state.actionLogs || [], { metric: config.metric, actionIds, bounds });
  return { blockId: block.id, metric: config.metric, bounds, logIds: aggregate.logIds, ...evaluateAvoidValue(aggregate.actual, config) };
}

export function evaluateAvoidActionPeriod({ logs, actionId, evaluation, now, timezone, bounds: suppliedBounds }) {
  const config = validateAvoidEvaluation(evaluation || {});
  const bounds = suppliedBounds || calculatePeriodBounds(config.period, now, timezone);
  const aggregate = aggregateLogsUnique(logs || [], { metric: config.metric, actionIds: [actionId], bounds });
  return { actionId, metric: config.metric, bounds, logIds: aggregate.logIds, ...evaluateAvoidValue(aggregate.actual, config) };
}
