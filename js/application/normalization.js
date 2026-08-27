import { clone } from "../shared/validation.js";
import { createId } from "../shared/ids.js";
import { BUILTIN_UNITS } from "../domain/units.js";
import { createRelationship } from "../domain/relationships.js";

export const STORAGE_SCHEMA_VERSION = "3.0.0";

export function createEmptyState(now = new Date()) {
  const stamp = new Date(now).toISOString();
  return { schemaVersion: STORAGE_SCHEMA_VERSION, createdAt: stamp, updatedAt: stamp, categories: [], tags: [], units: clone(BUILTIN_UNITS), actions: [], blocks: [], activations: [], runs: [], occurrences: [], periods: [], actionLogs: [], targetEvaluations: [], cycleSmallCycles: [], cycleBigCycles: [], history: [], settings: { timezone: "Europe/London", weekStartsOn: 1, defaults: { targetAutoClose: true, cycleAutoClose: true, cyclePositionPolicy: "continue", cycleMissedItemPolicy: "keep_position", routineExpire: true, actionListExpire: true } }, legacy: {}, meta: { migrationVersion: STORAGE_SCHEMA_VERSION, migratedFrom: null, appliedCommandIds: [] } };
}

export function isV3State(value) { return Boolean(value && String(value.schemaVersion || "").startsWith("3.")); }

export function migrateV2State(oldState, { now = new Date() } = {}) {
  if (isV3State(oldState)) return clone(oldState);
  const state = createEmptyState(now); const stamp = new Date(now).toISOString(); state.meta.migratedFrom = oldState?.schemaVersion || "2.x";
  state.categories = (oldState?.categories || []).map((category) => ({ id: category.id || createId("category", now), name: category.name || "Uncategorised", description: category.description || "", scope: category.scope || "both", status: category.status === "archived" ? "archived" : "active", createdAt: category.createdAt || stamp, updatedAt: category.updatedAt || stamp }));
  const categoryIds = new Set(state.categories.map((category) => category.id));
  const defaultCategory = state.categories[0] || { id: createId("category", now), name: "General", description: "Migrated default", scope: "both", status: "active", createdAt: stamp, updatedAt: stamp };
  if (!categoryIds.has(defaultCategory.id)) state.categories.push(defaultCategory);
  const fallbackCategory = state.categories[0].id;
  state.tags = state.categories.map((category) => ({ id: `tag_${category.id}`, categoryId: category.id, name: category.name, description: "Migrated category label", scope: "both", status: category.status, createdAt: category.createdAt, updatedAt: category.updatedAt }));
  state.actions = (oldState?.actions || []).map((action) => ({ id: action.id || createId("action", now), name: action.name || action.title || "Unnamed Action", description: action.description || "", tagIds: Array.isArray(action.tagIds) ? [...action.tagIds] : (action.categoryId ? [`tag_${action.categoryId}`] : []), direction: action.direction || (action.polarity === "negative" ? "avoid" : "do"), completion: action.completion || { method: "time", minimumMinutes: 0 }, resultFields: Array.isArray(action.resultFields) ? clone(action.resultFields) : migrateLegacyResult(action), status: action.status === "archived" ? "archived" : "active", createdAt: action.createdAt || stamp, updatedAt: action.updatedAt || stamp, legacy: { ...(clone(action.legacy) || {}), categoryId: action.categoryId || null } }));
  for (const action of state.actions) if (!state.categories.some((category) => category.id === action.categoryId) && action.categoryId) action.legacy = { ...action.legacy, categoryId: action.categoryId };
  const actionById = new Map(state.actions.map((action) => [action.id, action]));
  const actionByName = new Map(state.actions.map((action) => [String(action.name).toLocaleLowerCase(), action]));
  function ensureAction(id, name) { if (actionById.has(id)) return id; const existing = actionByName.get(String(name || "").toLocaleLowerCase()); if (existing) return existing.id; const action = { id: id || createId("action", now), name: name || "Migrated Action", description: "", tagIds: [], direction: "do", completion: { method: "time", minimumMinutes: 0 }, resultFields: [], status: "active", createdAt: stamp, updatedAt: stamp, legacy: {} }; state.actions.push(action); actionById.set(action.id, action); actionByName.set(action.name.toLocaleLowerCase(), action); return action.id; }
  state.blocks = [];
  for (const oldBlock of oldState?.blocks || []) {
    const relationships = (oldBlock.relationships || []).map((relationship, index) => createRelationship({ id: relationship.id, parentBlockId: oldBlock.id, kind: relationship.kind || "action", refId: relationship.refId || relationship.actionId, label: relationship.label, position: relationship.position ?? index, config: relationship.config, now })).filter((relationship) => relationship.refId);
    for (const actionId of oldBlock.actionIds || []) if (!relationships.some((relationship) => relationship.kind === "action" && relationship.refId === actionId)) relationships.push(createRelationship({ parentBlockId: oldBlock.id, kind: "action", refId: actionId, position: relationships.length, now }));
    state.blocks.push({ id: oldBlock.id || createId("block", now), type: oldBlock.type || "collection", name: oldBlock.name || "Migrated Block", description: oldBlock.description || "", definitionStatus: oldBlock.definitionStatus || (oldBlock.status === "archived" ? "ARCHIVED" : "ACTIVE"), relationships, config: clone(oldBlock.config || {}), createdAt: oldBlock.createdAt || stamp, updatedAt: oldBlock.updatedAt || stamp, legacy: { ...clone(oldBlock.legacy || {}), original: clone(oldBlock) } });
  }
  for (const oldCycle of oldState?.cycles || []) {
    const id = oldCycle.id || createId("cycle", now); const relationships = (oldCycle.items || []).map((item, index) => createRelationship({ id: item.id, parentBlockId: id, kind: item.kind === "block" ? "block" : "action", refId: item.refId || ensureAction(null, item.name), position: index, config: { frequency: 1, appearanceMode: "fixed", fixedCount: 1 }, now }));
    state.blocks.push({ id, type: "cycle", name: oldCycle.name || "Migrated Cycle", description: "", definitionStatus: oldCycle.status === "paused" ? "PAUSED" : "ACTIVE", relationships, config: { generationMode: "simple_ordered", currentPosition: Number(oldCycle.currentIndex) || 0, eligibility: "strict_order", missedItemPolicy: "keep_position", periodEnd: "never" }, createdAt: oldCycle.createdAt || stamp, updatedAt: oldCycle.updatedAt || stamp, legacy: { original: clone(oldCycle) } });
  }
  for (const oldProject of oldState?.projects || []) {
    const id = oldProject.id || createId("project", now); const relationships = (oldProject.actionIds || []).map((actionId, index) => createRelationship({ parentBlockId: id, kind: "action", refId: actionId, position: index, now }));
    state.blocks.push({ id, type: "project", name: oldProject.name || "Migrated Project", description: oldProject.description || "", definitionStatus: oldProject.status === "archived" ? "ARCHIVED" : "ACTIVE", relationships, config: { conditions: [{ type: "manual" }], combination: "all", deadline: oldProject.deadline || null, progress: oldProject.progress || 0 }, createdAt: oldProject.createdAt || stamp, updatedAt: oldProject.updatedAt || stamp, legacy: { original: clone(oldProject) } });
  }
  state.actionLogs = (oldState?.actionLogs || []).map((log) => ({ ...clone(log), id: log.id || createId("log", now), actionId: log.actionId || log.action?.id, resultValues: clone(log.resultValues || []), actionSnapshot: clone(log.actionSnapshot || null), legacy: { ...(clone(log.legacy) || {}), original: clone(log) } }));
  state.history = (oldState?.history || []).map((event, index) => ({ ...clone(event), id: event.id || createId("history", now), timestamp: event.timestamp || event.eventDateTime || stamp, type: event.type || "legacy", description: event.description || "Migrated History event", metadata: { ...(clone(event.metadata) || {}), migratedFrom: "2.x" }, sequence: index + 1 }));
  state.legacy = { sourceSchemaVersion: oldState?.schemaVersion || "2.x", sourceState: clone(oldState) };
  state.updatedAt = stamp; return state;
}

function migrateLegacyResult(action) {
  const legacy = action?.result || action?.resultField || action?.resultType;
  if (!legacy) return [];
  return [{ id: createId("result", new Date()), definitionVersion: 1, type: legacy.type || "text", label: legacy.label || "Result", required: false, position: 0, resultTagId: null, showInSummary: true, includeInAnalysis: true, config: clone(legacy.config || {}) }];
}

export function normalizeState(value, options = {}) { return isV3State(value) ? clone(value) : migrateV2State(value, options); }
