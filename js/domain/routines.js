import { finiteNumber, percentage } from "../shared/numbers.js";

export const ROUTINE_COMPLETION_MODES = ["count", "percentage", "required_only", "manual"];

export function calculateRoutineProgress({ relationships = [], completedRelationshipIds = [], requiredRelationshipIds = [] } = {}) {
  const completed = new Set(completedRelationshipIds); const required = new Set(requiredRelationshipIds);
  const total = relationships.length; const count = relationships.filter((relationship) => completed.has(relationship.id)).length;
  const requiredSatisfied = [...required].every((id) => completed.has(id));
  return { total, completed: count, percentage: total ? percentage(count, total) : 0, requiredSatisfied };
}

export function isRoutineQualified({ routine, progress } = {}) {
  const config = routine?.config || routine || {}; const mode = config.completionMode || "required_only"; const minimum = Math.max(0, Math.floor(finiteNumber(config.minimumCount, 0))); const threshold = finiteNumber(config.minimumPercentage, 100);
  if (!progress.requiredSatisfied) return false;
  if (mode === "count") return progress.completed >= minimum;
  if (mode === "percentage") return progress.percentage >= threshold;
  if (mode === "manual") return false;
  return true;
}
