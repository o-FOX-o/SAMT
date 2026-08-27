import { finiteNumber } from "../shared/numbers.js";
import { compareValues } from "./targets.js";
import { convertValue, isCompatible } from "./units.js";
import { choiceRank } from "./results.js";
import { ValidationError } from "../shared/errors.js";

export function evaluateProjectCondition(condition, context = {}) {
  if (condition.type === "all_required") return (context.required || []).every((item) => item.satisfied);
  if (condition.type === "count") return (context.completedCount || 0) >= finiteNumber(condition.value);
  if (condition.type === "percentage") return (context.completedPercentage || 0) >= finiteNumber(condition.value);
  if (condition.type === "target") return Boolean(context.targets?.[condition.targetId]?.reached);
  if (condition.type === "milestone") return Boolean(context.milestones?.[condition.milestoneId]?.satisfied ?? context.milestones?.[condition.milestoneId]?.status === "completed");
  if (condition.type === "result") {
    const actual = context.results?.[condition.fieldId]; const field = context.resultFields?.[condition.fieldId];
    if (actual == null) return false;
    if (field?.type === "choice") {
      if (!field.config?.orderMatters && condition.operator !== "=") return false;
      const left = condition.operator === "=" ? actual : choiceRank(field, actual); const right = condition.operator === "=" ? condition.value : choiceRank(field, condition.value); return left != null && right != null && compareValues(left, condition.operator || ">=", right);
    }
    if (field?.type === "measurement" && actual && typeof actual === "object") {
      const expectedUnit = condition.unitId || field.config?.defaultUnitId; const actualUnit = actual.unitId || field.config?.defaultUnitId; const value = expectedUnit && actualUnit && isCompatible(actualUnit, expectedUnit, context.units || []) ? convertValue(actual.value, actualUnit, expectedUnit, context.units || []) : Number(actual.value); return Number.isFinite(value) && compareValues(value, condition.operator || ">=", finiteNumber(condition.value));
    }
    return compareValues(typeof actual === "number" ? actual : finiteNumber(actual, NaN), condition.operator || ">=", finiteNumber(condition.value));
  }
  if (condition.type === "manual") return Boolean(context.manual);
  return false;
}

export function evaluateProjectConditions({ conditions = [], context = {}, combination = "all" } = {}) {
  const results = conditions.map((condition) => ({ condition, satisfied: evaluateProjectCondition(condition, context) }));
  const satisfied = combination === "any" ? results.some((result) => result.satisfied) : results.every((result) => result.satisfied);
  return { satisfied, results };
}

export function createMilestone({ id, name, description = "", dueAt = null, required = false, status = "open", now = new Date() } = {}) { if (!id || !String(name || "").trim()) throw new ValidationError("Milestone requires an ID and name."); if (!["open", "completed", "missed", "cancelled"].includes(status)) throw new ValidationError("Milestone status is invalid."); const stamp = new Date(now).toISOString(); return { id, name: String(name).trim(), description: String(description || ""), dueAt, required: Boolean(required), status, createdAt: stamp, updatedAt: stamp }; }

export function evaluateProjectRun({ project, required = [], completedCount = 0, completedPercentage = 0, targets = {}, results = {}, milestones = {}, manual = false, resultFields = {}, units = [] } = {}) {
  const config = project?.config || project || {}; const conditionResult = evaluateProjectConditions({ conditions: config.conditions || [{ type: "all_required" }], context: { required, completedCount, completedPercentage, targets, results, milestones, manual, resultFields, units }, combination: config.combination || "all" });
  return { ...conditionResult, status: conditionResult.satisfied ? (config.finishBehaviour === "auto" ? "COMPLETED" : "READY_TO_FINISH") : completedCount || completedPercentage ? "PARTIAL" : "NOT_STARTED" };
}
