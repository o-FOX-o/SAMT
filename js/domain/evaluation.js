import { closePeriod } from "./periods.js";
import { calculateTargetProgress } from "./targets.js";
import { evaluateAvoidFromLogs } from "./avoid.js";

export function evaluatePeriod({ period, target = null, avoid = null, logs = [], actions = [], resultField = null, units = [], now = new Date() } = {}) {
  const evaluation = target ? calculateTargetProgress({ target, logs, period, actions, resultField, units }) : avoid ? evaluateAvoidFromLogs({ ...avoid, logs, period }) : { status: "CLOSED" };
  return closePeriod(period, evaluation, now);
}
