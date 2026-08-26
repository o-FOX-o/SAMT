import { InvalidAvoidEvaluationError, ValidationError } from "../shared/errors.js";
import { normalizeName } from "../shared/validation.js";

export const ACTION_DIRECTIONS = ["do", "avoid"];
export const COMPLETION_METHODS = ["quantity", "time"];
export const RESULT_TYPES = ["none", "percentage", "score", "measurement"];

export function normalizeActionDefinition(action) {
  const completion = action.completion || action.completionConfiguration || {};
  const result = action.result || action.resultConfiguration || { mode: action.resultType || "none" };
  return {
    ...action,
    name: normalizeName(action.name),
    tagIds: Array.isArray(action.tagIds) ? [...action.tagIds] : [],
    direction: action.direction === "avoid" ? "avoid" : "do",
    completion: {
      method: completion.method || action.completionMethod || "quantity",
      target: completion.target ?? completion.minimum ?? 1,
      minimumMinutes: completion.minimumMinutes ?? completion.minutes ?? completion.target ?? 0
    },
    result: {
      mode: result.mode || action.resultType || "none",
      scoreMax: result.scoreMax ?? result.maximum ?? null,
      unitId: result.unitId ?? null,
      allowedUnitIds: Array.isArray(result.allowedUnitIds) ? [...result.allowedUnitIds] : (result.unitId ? [result.unitId] : [])
    },
    status: action.status === "archived" ? "archived" : "active"
  };
}

export function validateActionDefinition(input) {
  const action = normalizeActionDefinition(input);
  if (!action.id || typeof action.id !== "string") throw new ValidationError("Action needs a stable ID.");
  if (!action.name) throw new ValidationError("Action name is required.");
  if (!ACTION_DIRECTIONS.includes(action.direction)) throw new ValidationError("Action direction is invalid.");
  if (!COMPLETION_METHODS.includes(action.completion.method)) throw new ValidationError("Action completion method is invalid.");
  if (action.completion.method === "quantity") {
    const target = Number(action.completion.target);
    if (!Number.isInteger(target) || target < 1) throw new ValidationError("Quantity target must be a whole number of at least 1.");
  } else if (Number(action.completion.minimumMinutes) < 0) {
    throw new ValidationError("Minimum time cannot be negative.");
  }
  if (!RESULT_TYPES.includes(action.result.mode)) throw new ValidationError("Action result type is invalid.");
  if (action.result.mode === "score" && !(Number(action.result.scoreMax) > 0)) throw new ValidationError("Score maximum must be greater than zero.");
  if (action.result.mode === "measurement" && action.result.unitId != null && typeof action.result.unitId !== "string") throw new ValidationError("Measurement Unit is invalid.");
  if (action.direction === "avoid" && action.avoidMetricHint && !["time", "count", "quantity"].includes(action.avoidMetricHint)) {
    throw new InvalidAvoidEvaluationError("Avoid metric hint is invalid.");
  }
  return action;
}

export function createActionDefinition(input, { id, now }) {
  return validateActionDefinition({
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
    status: input.status || "active"
  });
}

export function updateActionDefinition(existing, patch, now) {
  if (!existing) throw new ValidationError("Existing Action is required.");
  return validateActionDefinition({ ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: now });
}
