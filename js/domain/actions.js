import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone, requireName } from "../shared/validation.js";
import { finiteNumber, positiveInteger } from "../shared/numbers.js";
import { validateResultFields } from "./results.js";

export const ACTION_DIRECTIONS = ["do", "avoid"];
export const COMPLETION_METHODS = ["quantity", "time"];

export function normalizeCompletion(completion = {}) {
  const method = completion.method || "time";
  if (!COMPLETION_METHODS.includes(method)) throw new ValidationError("Action completion method is invalid.");
  if (method === "quantity") return { method, target: positiveInteger(completion.target, 1) };
  return { method, minimumMinutes: Math.max(0, finiteNumber(completion.minimumMinutes, 0)) };
}

export function createAction({ id = null, name, description = "", tagIds = [], direction = "do", completion = {}, resultFields = [], status = "active", now = new Date() } = {}, context = {}) {
  if (!ACTION_DIRECTIONS.includes(direction)) throw new ValidationError("Action direction is invalid.");
  validateResultFields(resultFields, context.units || []);
  const stamp = new Date(now).toISOString();
  return { id: id || createId("action", now), name: requireName(name, "Action name"), description: String(description || ""), tagIds: [...new Set(tagIds)], direction, completion: normalizeCompletion(completion), resultFields: clone(resultFields) || [], status, createdAt: stamp, updatedAt: stamp };
}

export function validateAction(action, context = {}) {
  if (!action?.id || !requireName(action.name, "Action name")) throw new ValidationError("Action is invalid.");
  if (!ACTION_DIRECTIONS.includes(action.direction)) throw new ValidationError("Action direction is invalid.");
  normalizeCompletion(action.completion); validateResultFields(action.resultFields || [], context.units || []); return true;
}

export function isActionCompletionAchieved({ action, log } = {}) {
  const completion = normalizeCompletion(action?.completion);
  if (completion.method === "quantity") return finiteNumber(log?.quantity, 0) >= completion.target;
  return finiteNumber(log?.durationMinutes, 0) >= completion.minimumMinutes && (completion.minimumMinutes > 0 || finiteNumber(log?.durationMinutes, 0) > 0);
}

export function snapshotActionForLog(action) {
  return { id: action.id, name: action.name, direction: action.direction, completion: clone(action.completion), resultFields: (action.resultFields || []).map((field) => ({ id: field.id, definitionVersion: field.definitionVersion, type: field.type, label: field.label, config: clone(field.config), required: field.required })) };
}
