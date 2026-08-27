import { finiteNumber } from "../shared/numbers.js";
import { compareValues } from "./targets.js";

export function evaluateProjectCondition(condition, context = {}) {
  if (condition.type === "all_required") return (context.required || []).every((item) => item.satisfied);
  if (condition.type === "count") return (context.completedCount || 0) >= finiteNumber(condition.value);
  if (condition.type === "percentage") return (context.completedPercentage || 0) >= finiteNumber(condition.value);
  if (condition.type === "target") return Boolean(context.targets?.[condition.targetId]?.reached);
  if (condition.type === "result") return compareValues(finiteNumber(context.results?.[condition.fieldId]), condition.operator || ">=", finiteNumber(condition.value));
  if (condition.type === "manual") return Boolean(context.manual);
  return false;
}

export function evaluateProjectConditions({ conditions = [], context = {}, combination = "all" } = {}) {
  const results = conditions.map((condition) => ({ condition, satisfied: evaluateProjectCondition(condition, context) }));
  const satisfied = combination === "any" ? results.some((result) => result.satisfied) : results.every((result) => result.satisfied);
  return { satisfied, results };
}

export function createMilestone({ id, name, description = "", dueAt = null, required = false, status = "open" } = {}) { return { id, name, description, dueAt, required, status }; }
