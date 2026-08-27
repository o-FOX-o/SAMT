import { InvalidAvoidEvaluationError } from "../shared/errors.js";
import { finiteNumber } from "../shared/numbers.js";
import { aggregateLogsUnique } from "./logs.js";

export function evaluateAvoidPeriod({ mode = "binary_limit", actual = 0, allowed = 0, anchors = [], violations = null, penaltyPercent = 100 } = {}) {
  const value = finiteNumber(actual);
  if (!["binary_limit", "scored_range", "violation_multiplier"].includes(mode)) throw new InvalidAvoidEvaluationError("Avoid mode is invalid.");
  if (mode === "binary_limit") return { mode, actual: value, allowed: finiteNumber(allowed), score: value <= finiteNumber(allowed) ? 100 : 0, status: value <= finiteNumber(allowed) ? "SUCCESS" : "FAILED", irreversible: value > finiteNumber(allowed) };
  if (mode === "violation_multiplier") { const count = violations == null ? value : finiteNumber(violations); const failureLoad = Math.max(0, count - finiteNumber(allowed)) * finiteNumber(penaltyPercent, 100); return { mode, violations: count, allowed: finiteNumber(allowed), failureLoad, score: failureLoad ? -failureLoad : 100, status: failureLoad ? "FAILED" : "SUCCESS", irreversible: failureLoad > 0 }; }
  const sorted = [...anchors].sort((a, b) => Number(a.actual) - Number(b.actual)); if (sorted.length < 2) throw new InvalidAvoidEvaluationError("Scored range requires at least two anchors.");
  let lower = sorted[0], upper = sorted[1];
  if (value <= Number(sorted[0].actual)) { lower = upper = sorted[0]; }
  else if (value >= Number(sorted.at(-1).actual)) { lower = upper = sorted.at(-1); }
  else for (let i = 0; i < sorted.length - 1; i += 1) if (value >= sorted[i].actual && value <= sorted[i + 1].actual) { lower = sorted[i]; upper = sorted[i + 1]; break; }
  const span = Number(upper.actual) - Number(lower.actual); const ratio = span === 0 ? 0 : (value - Number(lower.actual)) / span; const score = Number(lower.score) + (Number(upper.score) - Number(lower.score)) * ratio;
  return { mode, actual: value, score, status: score >= 0 ? "SUCCESS" : "FAILED", irreversible: score < 0, anchors: sorted };
}

export function evaluateAvoidFromLogs({ actionId, logs = [], period, config } = {}) {
  const selected = aggregateLogsUnique(logs, (log) => log.actionId === actionId && (!period || (!period.start || new Date(log.eventAt) >= new Date(period.start)) && (!period.end || new Date(log.eventAt) < new Date(period.end))));
  const actual = selected.reduce((sum, log) => sum + finiteNumber(log.durationMinutes), 0); return { ...evaluateAvoidPeriod({ ...config, actual, violations: config?.metric === "count" ? selected.length : config?.violations }), logs: selected };
}
