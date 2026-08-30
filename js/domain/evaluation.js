import { closePeriod } from "./periods.js";
import { calculateTargetProgress } from "./targets.js";
import { evaluateAvoidFromLogs } from "./avoid.js";

function resultFieldForTarget(target, actions, explicit = null) {
  if (explicit) return explicit;
  const config = target?.config || target || {};
  return (actions || []).flatMap((action) => action.resultFields || [])
    .find((field) => field.id === config.sourceResultFieldId || config.sourceResultTagId && field.resultTagId === config.sourceResultTagId) || null;
}

function targetProgressForPeriod(target, { logs, period, actions, blocks, units, memo, visiting } = {}) {
  if (!target?.id) return { targetId: null, reached: false, status: "INVALID", error: "Required Target is missing." };
  if (memo.has(target.id)) return memo.get(target.id);
  if (visiting.has(target.id)) return { targetId: target.id, reached: false, status: "INVALID", error: "Required Target dependency cycle." };
  visiting.add(target.id);
  const childResults = ((target.config || {}).requiredChildTargetIds || []).map((childId) => {
    const child = (blocks || []).find((block) => block.id === childId && block.type === "target");
    return targetProgressForPeriod(child, { logs, period, actions, blocks, units, memo, visiting });
  });
  let result;
  try {
    result = calculateTargetProgress({ target, logs, period, actions, blocks, resultField: resultFieldForTarget(target, actions), units, childResults });
  } catch (error) {
    result = { targetId: target.id, actual: null, targetValue: target.config?.targetValue ?? 0, reached: false, status: "INVALID", error: error.message };
  }
  visiting.delete(target.id);
  memo.set(target.id, result);
  return result;
}

export function evaluatePeriod({ period, target = null, avoid = null, logs = [], actions = [], blocks = [], resultField = null, units = [], now = new Date() } = {}) {
  let evaluation;
  if (target) {
    evaluation = targetProgressForPeriod(target, { logs, period, actions, blocks, units, memo: new Map(), visiting: new Set() });
    if (resultField && target.config?.sourceResultFieldId === resultField.id) evaluation = calculateTargetProgress({ target, logs, period, actions, blocks, resultField, units, childResults: [] });
  } else if (avoid) {
    evaluation = evaluateAvoidFromLogs({ ...avoid, logs, period });
  } else {
    evaluation = { status: "CLOSED" };
  }
  return closePeriod(period, evaluation, now);
}
