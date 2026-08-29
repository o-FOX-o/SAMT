import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone, requireName } from "../shared/validation.js";
import { finiteNumber, positiveInteger } from "../shared/numbers.js";
import { validateResultFields, normalizeResultConfig } from "./results.js";

export const ACTION_DIRECTIONS = ["do", "avoid"];
export const COMPLETION_METHODS = ["quantity", "time"];

export function normalizeCompletion(completion = {}) {
  const method = completion.method || "time";
  if (!COMPLETION_METHODS.includes(method)) throw new ValidationError("Action completion method is invalid.");
  if (method === "quantity") return { method, target: positiveInteger(completion.target, 1) };
  return { method, minimumMinutes: Math.max(0, finiteNumber(completion.minimumMinutes, 0)) };
}

export function createAction({ id = null, name, description = "", tagIds = [], direction = "do", completion = {}, resultFields = [], avoid = null, status = "active", now = new Date() } = {}, context = {}) {
  if (!ACTION_DIRECTIONS.includes(direction)) throw new ValidationError("Action direction is invalid.");
  validateResultFields(resultFields, context.units || []);
  if (!["active", "archived"].includes(status)) throw new ValidationError("Action status is invalid.");
  if (context.tags && tagIds.some((tagId) => !context.tags.some((tag) => tag.id === tagId && ["action", "both"].includes(tag.scope)))) throw new ValidationError("Action references a missing or result-only Tag.");
  const stamp = new Date(now).toISOString();
  return { id: id || createId("action", now), name: requireName(name, "Action name"), description: String(description || ""), tagIds: [...new Set(tagIds)], direction, completion: normalizeCompletion(completion), resultFields: (clone(resultFields) || []).map((field) => ({ ...field, config: normalizeResultConfig(field) })), avoid: direction === "avoid" ? clone(avoid) : null, status, createdAt: stamp, updatedAt: stamp };
}

export function validateAction(action, context = {}) {
  if (!action?.id || !requireName(action.name, "Action name")) throw new ValidationError("Action is invalid.");
  if (!ACTION_DIRECTIONS.includes(action.direction)) throw new ValidationError("Action direction is invalid.");
  if (!["active", "archived"].includes(action.status || "active")) throw new ValidationError("Action status is invalid.");
  normalizeCompletion(action.completion); validateResultFields(action.resultFields || [], context.units || []);
  if (context.tags && (action.tagIds || []).some((tagId) => !context.tags.some((tag) => tag.id === tagId && ["action", "both"].includes(tag.scope)))) throw new ValidationError("Action references a missing or result-only Tag.");
  if (context.tags && context.categories) for (const field of action.resultFields || []) if (field.resultTagId && !context.tags.some((tag) => tag.id === field.resultTagId && ["result", "both"].includes(tag.scope))) throw new ValidationError("Result Field references an invalid Result Tag.");
  return true;
}

export function isActionCompletionAchieved({ action, log } = {}) {
  const completion = normalizeCompletion(action?.completion);
  if (completion.method === "quantity") return finiteNumber(log?.quantity, 0) >= completion.target;
  return finiteNumber(log?.durationMinutes, 0) >= completion.minimumMinutes && (completion.minimumMinutes > 0 || finiteNumber(log?.durationMinutes, 0) > 0);
}

export function snapshotActionForLog(action) {
  return { id: action.id, name: action.name, direction: action.direction, completion: clone(action.completion), avoid: clone(action.avoid), resultFields: (action.resultFields || []).map((field) => ({ id: field.id, definitionVersion: field.definitionVersion, type: field.type, label: field.label, config: clone(field.config), required: field.required })) };
}

export function versionResultFields(previous = [], next = [], now = new Date()) {
  const oldById = new Map(previous.map((field) => [field.id, field]));
  const stamp = new Date(now).toISOString();
  const semantic = (field) => {
    const config = normalizeResultConfig(field);
    if (field.type === "text") {
      delete config.displaySize;
      delete config.placeholder;
    }
    return { type: field.type, required: Boolean(field.required), resultTagId: field.resultTagId || null, config };
  };
  return next.map((field) => {
    const old = oldById.get(field.id);
    if (!old) return { ...clone(field), definitionVersion: Math.max(1, Number(field.definitionVersion) || 1), updatedAt: stamp };
    const changed = JSON.stringify(semantic(old)) !== JSON.stringify(semantic(field));
    return {
      ...clone(field),
      definitionVersion: changed ? Math.max(Number(old.definitionVersion) || 1, Number(field.definitionVersion) || 1) + 1 : Number(old.definitionVersion) || 1,
      createdAt: old.createdAt || field.createdAt || stamp,
      updatedAt: stamp
    };
  });
}
