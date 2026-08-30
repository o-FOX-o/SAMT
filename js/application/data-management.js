import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { clone, normalizedKey } from "../shared/validation.js";
import { validateUnits } from "../domain/units.js";
import { validateTaxonomy } from "../domain/taxonomy.js";
import { validateAction, versionResultFields, isActionCompletionAchieved } from "../domain/actions.js";
import { validateResultFields } from "../domain/results.js";
import { validateBlockGraph } from "../domain/relationships.js";
import { resolveOccurrenceStatus } from "../domain/occurrences.js";
import { createEmptyState } from "./normalization.js";
import { buildDataManagerIndex, definitionCollection, getDefinitionImpact, filterDataManagerRecords } from "./data-manager.js";

const DEFINITION_TYPES = ["category", "tag", "unit", "action", "block"];
const DEFINITION_STATUS = { category: "status", tag: "status", unit: "status", action: "status", block: "definitionStatus" };
const STATUS_ARCHIVED = { category: "archived", tag: "archived", unit: "archived", action: "archived", block: "ARCHIVED" };

function rows(state, type) { const collection = definitionCollection(type); return collection ? (Array.isArray(state[collection]) ? state[collection] : []) : []; }
function findDefinition(state, type, id) { return rows(state, type).find((item) => item.id === id) || null; }
function binEntry(state, id) { return (state.bin || []).find((entry) => entry.id === id || entry.objectId === id) || null; }
function definitionName(item, id) { return String(item?.name || item?.label || item?.symbol || id || "Untitled"); }
function nowStamp(now) { return new Date(now || new Date()).toISOString(); }

export function appendRestorePoint(state, { id, reason = "Settings data management", now = new Date() } = {}) {
  state.meta = state.meta || {};
  const point = { id: id || `restore_point_${Date.now()}`, createdAt: nowStamp(now), reason, state: clone(state) };
  state.meta.restorePoints = [...(state.meta.restorePoints || []), point].slice(-10);
  return point;
}

function ensureSelection(selections = []) {
  const result = []; const seen = new Set();
  for (const selection of selections || []) {
    const type = selection?.type; const id = selection?.id;
    if (!DEFINITION_TYPES.includes(type) || !id) throw new ValidationError("Only Category, Tag, Unit, Action and Block definitions can be managed here.");
    const key = `${type}:${id}`; if (seen.has(key)) continue; seen.add(key); result.push({ type, id });
  }
  if (!result.length) throw new ValidationError("Select at least one definition.");
  return result;
}

function selectedDefinition(state, selection) {
  return findDefinition(state, selection.type, selection.id)
    || binEntry(state, selection.id)?.snapshot
    || null;
}

function orderForRemoval(state, selections) {
  const rank = { block: 0, action: 1, tag: 2, category: 3, unit: 4 };
  return selections.slice().sort((left, right) => {
    // Preserve a parent Block's original relationship snapshot before a
    // selected child is removed from it. This keeps multi-select Bin/restore
    // operations lossless while still removing definitions atomically.
    if (left.type === "block" && right.type === "block") {
      const leftItem = selectedDefinition(state, left); const rightItem = selectedDefinition(state, right);
      const leftReferencesRight = [...(leftItem?.relationships || []).map((relationship) => relationship.kind === "block" ? relationship.refId : null), leftItem?.config?.sourceBlockId, ...(leftItem?.config?.descendantBlockIds || []), ...(leftItem?.config?.requiredChildTargetIds || [])].includes(right.id);
      const rightReferencesLeft = [...(rightItem?.relationships || []).map((relationship) => relationship.kind === "block" ? relationship.refId : null), rightItem?.config?.sourceBlockId, ...(rightItem?.config?.descendantBlockIds || []), ...(rightItem?.config?.requiredChildTargetIds || [])].includes(left.id);
      if (leftReferencesRight && !rightReferencesLeft) return -1;
      if (rightReferencesLeft && !leftReferencesRight) return 1;
    }
    if (left.type === "unit" && right.type === "unit") {
      const leftItem = selectedDefinition(state, left); const rightItem = selectedDefinition(state, right);
      if (leftItem?.baseUnitId === right.id) return -1;
      if (rightItem?.baseUnitId === left.id) return 1;
    }
    return (rank[left.type] ?? 99) - (rank[right.type] ?? 99);
  });
}

function requireDefinition(state, type, id, { fromBin = false } = {}) {
  const live = findDefinition(state, type, id);
  if (live) return { type, id, item: live, live: true, bin: null };
  const entry = fromBin ? binEntry(state, id) : null;
  if (entry && entry.objectType === type && entry.snapshot) return { type, id, item: clone(entry.snapshot), live: false, bin: entry };
  throw new NotFoundError(`${type} not found: ${id}`);
}

function statusOf(type, item) { return item?.[DEFINITION_STATUS[type]]; }
function setStatus(type, item, now) {
  const prior = statusOf(type, item);
  return { ...item, [DEFINITION_STATUS[type]]: STATUS_ARCHIVED[type], archivedFromStatus: prior === STATUS_ARCHIVED[type] ? item.archivedFromStatus : prior, updatedAt: nowStamp(now) };
}

function addBinEntry(state, definition, impact, now) {
  const existing = binEntry(state, definition.id);
  if (existing) throw new ConflictError(`${definitionName(definition, definition.id)} is already in the Bin.`);
  state.bin = state.bin || [];
  state.bin.push({
    id: definition.id,
    objectId: definition.id,
    objectType: impact.type,
    nameSnapshot: definitionName(definition, definition.id),
    deletedAt: nowStamp(now),
    previousStatus: statusOf(impact.type, definition),
    snapshot: clone(definition),
    dependencyMetadata: {
      activeReferenceCount: impact.activeReferenceCount,
      historicalReferenceCount: impact.historicalReferenceCount,
      missing: [],
      children: clone(impact.childReferences) || [],
      wasPrimaryProject: impact.type === "block" && state.settings?.primaryProjectId === definition.id
    }
  });
}

function captureRelationshipSnapshots(state, relationships, definition, parent) {
  for (const relationship of relationships || []) {
    for (const occurrence of state.occurrences || []) if (occurrence.relationshipId === relationship.id) {
      occurrence.snapshot = {
        ...(clone(occurrence.snapshot) || {}),
        relationshipSnapshot: clone(relationship),
        blockSnapshot: clone(parent),
        actionSnapshot: relationship.kind === "action" ? clone(definition.type === "action" ? definition : state.actions?.find((action) => action.id === relationship.refId)) : occurrence.snapshot?.actionSnapshot || null
      };
    }
  }
  for (const log of state.actionLogs || []) for (const reference of log.contextRefs || []) {
    if (reference.blockId === parent?.id && !reference.blockSnapshot) reference.blockSnapshot = clone(parent);
  }
}

function stripDefinitionReferences(state, type, definition, now = new Date()) {
  if (type === "category") {
    const dependentTags = (state.tags || []).filter((tag) => tag.categoryId === definition.id);
    if (dependentTags.length) throw new ConflictError(`Category ${definitionName(definition, definition.id)} still owns ${dependentTags.length} Tag(s). Archive it or handle those Tags first.`, { dependentTags: dependentTags.map((tag) => tag.id) });
    return;
  }
  if (type === "tag") {
    for (const action of state.actions || []) {
      if ((action.tagIds || []).includes(definition.id)) action.tagIds = action.tagIds.filter((id) => id !== definition.id);
      if ((action.resultFields || []).some((field) => field.resultTagId === definition.id)) action.resultFields = versionResultFields(action.resultFields || [], action.resultFields.map((field) => field.resultTagId === definition.id ? { ...field, resultTagId: null } : field), now);
    }
    return;
  }
  if (type === "unit") {
    for (const unit of state.units || []) if (unit.id !== definition.id && unit.baseUnitId === definition.id) throw new ConflictError(`Unit ${definitionName(definition, definition.id)} is the base Unit for ${unit.name}. Handle that dependency first.`, { dependentUnits: [unit.id] });
    for (const action of state.actions || []) {
      const nextFields = (action.resultFields || []).map((field) => {
        if (field.type !== "measurement") return field;
        const config = field.config || {};
        if (config.defaultUnitId !== definition.id && !(config.allowedUnitIds || []).includes(definition.id)) return field;
        const allowedUnitIds = (config.allowedUnitIds || []).filter((id) => id !== definition.id);
        return { ...field, config: { ...config, defaultUnitId: config.defaultUnitId === definition.id ? null : config.defaultUnitId, allowedUnitIds } };
      });
      action.resultFields = versionResultFields(action.resultFields || [], nextFields, now);
    }
    for (const block of state.blocks || []) if (block.config?.unitId === definition.id) block.config = { ...block.config, unitId: null };
    return;
  }
  if (type === "action") {
    for (const block of state.blocks || []) {
      const removed = (block.relationships || []).filter((relationship) => relationship.kind === "action" && relationship.refId === definition.id);
      captureRelationshipSnapshots(state, removed, definition, block);
      block.relationships = (block.relationships || []).filter((relationship) => !(relationship.kind === "action" && relationship.refId === definition.id));
      if (Array.isArray(block.config?.sourceActionIds)) block.config.sourceActionIds = block.config.sourceActionIds.filter((id) => id !== definition.id);
    }
    for (const task of [...(state.tasks || []), ...(state.quickTasks || [])]) if (task.actionId === definition.id) {
      task.actionSnapshot = clone(definition);
      task.actionId = null;
    }
    return;
  }
  if (type === "block") {
    if (state.settings?.primaryProjectId === definition.id) state.settings.primaryProjectId = null;
    for (const parent of state.blocks || []) {
      const removed = (parent.relationships || []).filter((relationship) => relationship.kind === "block" && relationship.refId === definition.id);
      parent.relationships = (parent.relationships || []).filter((relationship) => !(relationship.kind === "block" && relationship.refId === definition.id));
      if (removed.length) captureRelationshipSnapshots(state, removed, definition, parent);
      const config = parent.config || {};
      if (config.sourceBlockId === definition.id || (config.descendantBlockIds || []).includes(definition.id) || (config.requiredChildTargetIds || []).includes(definition.id)) {
        parent.config = {
          ...config,
          sourceBlockId: config.sourceBlockId === definition.id ? null : config.sourceBlockId,
          descendantBlockIds: (config.descendantBlockIds || []).filter((blockId) => blockId !== definition.id),
          requiredChildTargetIds: (config.requiredChildTargetIds || []).filter((blockId) => blockId !== definition.id)
        };
      }
    }
    captureRelationshipSnapshots(state, definition.relationships || [], definition, definition);
    for (const activation of state.activations || []) if (activation.blockId === definition.id) activation.blockSnapshot = clone(definition);
    for (const run of state.runs || []) if (run.blockId === definition.id) run.snapshot = { ...(clone(run.snapshot) || {}), block: clone(definition) };
    for (const period of state.periods || []) if (period.ownerId === definition.id) period.blockSnapshot = clone(definition);
  }
}

function validateManagedState(state) {
  validateTaxonomy(state); validateUnits(state.units || []);
  for (const action of state.actions || []) { validateAction(action, { units: state.units || [], tags: state.tags || [], categories: state.categories || [] }); validateResultFields(action.resultFields || [], state.units || []); }
  validateBlockGraph({ blocks: state.blocks || [], actions: state.actions || [] });
  return true;
}

export function archiveDefinitionsInState(state, selections, { now = new Date() } = {}) {
  const selected = ensureSelection(selections); const archived = [];
  for (const { type, id } of selected) {
    const item = findDefinition(state, type, id); if (!item) throw new NotFoundError(`${type} not found: ${id}`);
    if (type === "unit" && item.builtIn) throw new ConflictError("Built-in Units cannot be archived or deleted.");
    const collection = definitionCollection(type); const index = state[collection].findIndex((candidate) => candidate.id === id); state[collection][index] = setStatus(type, item, now); archived.push({ type, id });
  }
  validateManagedState(state); return archived;
}

export function unarchiveDefinitionsInState(state, selections, { now = new Date() } = {}) {
  const selected = ensureSelection(selections); const restored = [];
  for (const { type, id } of selected) {
    const item = findDefinition(state, type, id); if (!item) throw new NotFoundError(`${type} not found: ${id}`);
    const archived = statusOf(type, item) === STATUS_ARCHIVED[type];
    if (!archived) throw new ConflictError(`${definitionName(item, id)} is not archived.`);
    const collection = definitionCollection(type); const index = state[collection].findIndex((candidate) => candidate.id === id);
    const { archivedFromStatus, ...withoutArchiveMarker } = item;
    const previousStatus = archivedFromStatus && archivedFromStatus !== STATUS_ARCHIVED[type] ? archivedFromStatus : (type === "block" ? "ACTIVE" : "active");
    state[collection][index] = { ...withoutArchiveMarker, [DEFINITION_STATUS[type]]: previousStatus, updatedAt: nowStamp(now) };
    restored.push({ type, id });
  }
  validateManagedState(state); return restored;
}

export function moveDefinitionsToBinInState(state, selections, { now = new Date(), removeLiveRelationships = false } = {}) {
  const selected = orderForRemoval(state, ensureSelection(selections)); const moved = [];
  for (const { type, id } of selected) {
    const item = findDefinition(state, type, id); if (!item) throw new NotFoundError(`${type} not found: ${id}`);
    if (type === "unit" && item.builtIn) throw new ConflictError("Built-in Units cannot be moved to the Bin.");
    const impact = getDefinitionImpact(state, type, id);
    if (impact.blockedBy) throw new ConflictError(`Cannot move ${definitionName(item, id)} to the Bin while dependent Tags remain.`, { impact });
    if (impact.activeReferenceCount && !removeLiveRelationships) throw new ConflictError(`${definitionName(item, id)} is referenced by live definitions. Review the impact before moving it to the Bin.`, { impact });
    addBinEntry(state, item, impact, now);
    if (removeLiveRelationships) stripDefinitionReferences(state, type, item, now);
    const collection = definitionCollection(type); state[collection] = state[collection].filter((candidate) => candidate.id !== id); moved.push({ type, id });
  }
  validateManagedState(state); return moved;
}

export function permanentlyDeleteDefinitionsInState(state, selections, { now = new Date(), removeLiveRelationships = false, fromBin = false } = {}) {
  const selected = orderForRemoval(state, ensureSelection(selections)); const deleted = []; const tombstones = [];
  for (const { type, id } of selected) {
    const resolved = requireDefinition(state, type, id, { fromBin }); const item = resolved.item;
    if (type === "unit" && item.builtIn) throw new ConflictError("Built-in Units cannot be permanently deleted.");
    const impact = getDefinitionImpact(state, type, id);
    if (impact.blockedBy) throw new ConflictError(`Cannot permanently delete ${definitionName(item, id)} while dependent definitions remain.`, { impact });
    if (impact.activeReferenceCount && !removeLiveRelationships) throw new ConflictError(`${definitionName(item, id)} has live references. Archive it or review the impact first.`, { impact });
    if (resolved.live && removeLiveRelationships) stripDefinitionReferences(state, type, item, now);
    const collection = definitionCollection(type); state[collection] = state[collection].filter((candidate) => candidate.id !== id);
    state.bin = (state.bin || []).filter((entry) => entry.id !== id && entry.objectId !== id);
    if (impact.historicalReferenceCount) {
      const tombstone = { id: `tombstone_${type}_${id}_${new Date(now).getTime()}`, objectId: id, objectType: type, name: definitionName(item, id), deletedAt: nowStamp(now), historicalReferenceCount: impact.historicalReferenceCount, snapshot: clone(item) };
      state.tombstones = [...(state.tombstones || []), tombstone]; tombstones.push(tombstone.id);
    }
    deleted.push({ type, id });
  }
  validateManagedState(state); return { deleted, tombstones };
}

function missingDependencies(state, type, snapshot) {
  const missing = [];
  const exists = (kind, id) => Boolean(findDefinition(state, kind, id));
  if (type === "tag" && snapshot.categoryId && !findDefinition(state, "category", snapshot.categoryId)) missing.push({ type: "category", id: snapshot.categoryId });
  if (type === "action") {
    for (const id of snapshot.tagIds || []) if (!exists("tag", id)) missing.push({ type: "tag", id });
    for (const field of snapshot.resultFields || []) {
      if (field.resultTagId && !exists("tag", field.resultTagId)) missing.push({ type: "tag", id: field.resultTagId });
      for (const id of [field.config?.defaultUnitId, ...(field.config?.allowedUnitIds || [])].filter(Boolean)) if (!exists("unit", id)) missing.push({ type: "unit", id });
    }
  }
  if (type === "unit" && snapshot.baseUnitId && !exists("unit", snapshot.baseUnitId)) missing.push({ type: "unit", id: snapshot.baseUnitId });
  if (type === "block") for (const relationship of snapshot.relationships || []) if (!exists(relationship.kind === "action" ? "action" : "block", relationship.refId)) missing.push({ type: relationship.kind === "action" ? "action" : "block", id: relationship.refId });
  if (type === "block") {
    for (const id of [snapshot.config?.sourceBlockId, ...(snapshot.config?.descendantBlockIds || []), ...(snapshot.config?.requiredChildTargetIds || [])].filter(Boolean)) if (!exists("block", id)) missing.push({ type: "block", id });
    for (const id of (snapshot.config?.sourceActionIds || []).filter(Boolean)) if (!exists("action", id)) missing.push({ type: "action", id });
  }
  return missing.filter((item, index, list) => list.findIndex((candidate) => candidate.type === item.type && candidate.id === item.id) === index);
}

function restoreOne(state, type, id, { restoreDependencies = false, seen = new Set(), selectedKeys = new Set() } = {}) {
  const key = `${type}:${id}`; if (seen.has(key)) return []; seen.add(key);
  if (findDefinition(state, type, id)) { state.bin = (state.bin || []).filter((entry) => entry.id !== id && entry.objectId !== id); return []; }
  const entry = binEntry(state, id); if (!entry || entry.objectType !== type || !entry.snapshot) throw new NotFoundError(`${type} is not in the Bin: ${id}`);
  const missing = missingDependencies(state, type, entry.snapshot);
  const selectedDependencies = missing.filter((dependency) => selectedKeys.has(`${dependency.type}:${dependency.id}`));
  const unresolved = missing.filter((dependency) => !selectedKeys.has(`${dependency.type}:${dependency.id}`));
  if (unresolved.length && !restoreDependencies) throw new ConflictError(`${definitionName(entry.snapshot, id)} needs missing dependencies before it can be restored.`, { missingDependencies: unresolved });
  const restoredDependencies = [];
  for (const dependency of [...selectedDependencies, ...(restoreDependencies ? unresolved : [])]) {
    const dependencyEntry = binEntry(state, dependency.id);
    if (!dependencyEntry || dependencyEntry.objectType !== dependency.type) throw new ConflictError(`Required ${dependency.type} ${dependency.id} is unavailable for restore.`, { missingDependencies: [dependency] });
    restoredDependencies.push(...restoreOne(state, dependency.type, dependency.id, { restoreDependencies: true, seen, selectedKeys }));
  }
  const collection = definitionCollection(type); const item = clone(entry.snapshot);
  if (state[collection].some((candidate) => candidate.id !== id && normalizedKey(candidate.name) === normalizedKey(item.name))) throw new ConflictError(`${type} name already exists: ${item.name}`);
  state[collection].push(item);
  if (type === "block" && item.type === "project" && entry.dependencyMetadata?.wasPrimaryProject && !state.settings?.primaryProjectId) state.settings.primaryProjectId = id;
  state.bin = (state.bin || []).filter((candidate) => candidate.id !== id && candidate.objectId !== id);
  return [...restoredDependencies, { type, id }];
}

export function restoreDefinitionsInState(state, selections, { restoreDependencies = false } = {}) {
  const selected = ensureSelection(selections); const restored = []; const seen = new Set(); const selectedKeys = new Set(selected.map((selection) => `${selection.type}:${selection.id}`));
  for (const { type, id } of selected) restored.push(...restoreOne(state, type, id, { restoreDependencies, seen, selectedKeys }));
  validateManagedState(state); return restored;
}

function filteredIds(state, type, options) {
  const index = filterDataManagerRecords(buildDataManagerIndex(state), options, { now: options.now || new Date() });
  return index.records.filter((record) => record.type === type).map((record) => record.id);
}

function relationshipForRun(run, relationshipId) {
  return (run.snapshot?.relationships || run.snapshot?.block?.relationships || []).find((relationship) => relationship.id === relationshipId) || null;
}

function actionLogsForRun(state, runId, relationshipId) {
  return (state.actionLogs || []).filter((log) => (log.contextRefs || []).some((reference) =>
    reference.runId === runId && (!relationshipId || reference.relationshipId === relationshipId)
  ));
}

function refreshRunItemsAfterLogRemoval(state, run, items, removed, stamp) {
  let changed = false;
  const nextItems = (items || []).map((item) => {
    const beforeLogIds = item.logIds || [];
    if (!beforeLogIds.some((id) => removed.has(id))) return item;
    changed = true;
    const logIds = beforeLogIds.filter((id) => !removed.has(id));
    const completedLogIds = (item.completedLogIds || []).filter((id) => !removed.has(id));
    let next = { ...item, logIds, completedLogIds, updatedAt: stamp };
    const relationshipId = item.relationshipId || item.id;
    const relationship = relationshipForRun(run, relationshipId);
    const action = relationship?.kind === "action"
      ? (state.actions || []).find((candidate) => candidate.id === relationship.refId)
      : null;
    if (next.state === "COMPLETED" && action && relationship?.config?.manualCompletion !== true) {
      const logs = actionLogsForRun(state, run.id, relationshipId);
      const aggregate = {
        quantity: logs.reduce((sum, log) => sum + Number(log.quantity || 0), 0),
        durationMinutes: logs.reduce((sum, log) => sum + Number(log.durationMinutes || 0), 0),
        logs
      };
      if (!isActionCompletionAchieved({ action, log: aggregate })) {
        next = { ...next, state: logs.length ? "IN_PROGRESS" : "AVAILABLE", completedLogIds: [] };
      }
    }
    return next;
  });
  return { items: nextItems, changed };
}

function stripNestedRuntimeLogIds(value, removed) {
  if (Array.isArray(value)) return value.map((item) => stripNestedRuntimeLogIds(item, removed));
  if (!value || typeof value !== "object") return value;
  const next = { ...value };
  if (Array.isArray(next.logIds)) next.logIds = next.logIds.filter((id) => !removed.has(id));
  if (Array.isArray(next.completedLogIds)) next.completedLogIds = next.completedLogIds.filter((id) => !removed.has(id));
  for (const key of ["children", "steps"]) if (Array.isArray(next[key])) next[key] = next[key].map((item) => stripNestedRuntimeLogIds(item, removed));
  if (next.runtime && typeof next.runtime === "object") next.runtime = stripNestedRuntimeLogIds(next.runtime, removed);
  if (next.childRuntime && typeof next.childRuntime === "object") next.childRuntime = stripNestedRuntimeLogIds(next.childRuntime, removed);
  return next;
}

function refreshRunsAfterLogRemoval(state, removed, now = new Date()) {
  const stamp = new Date(now).toISOString();
  const affectedRuns = [];
  for (const run of state.runs || []) {
    const sourceChildren = Array.isArray(run.children) ? run.children : run.runtime?.children || null;
    const sourceSteps = Array.isArray(run.steps) ? run.steps : run.runtime?.steps || null;
    const childResult = refreshRunItemsAfterLogRemoval(state, run, sourceChildren, removed, stamp);
    const stepResult = refreshRunItemsAfterLogRemoval(state, run, sourceSteps, removed, stamp);
    const strippedRuntime = stripNestedRuntimeLogIds(run.runtime, removed);
    const nestedRuntimeChanged = JSON.stringify(strippedRuntime) !== JSON.stringify(run.runtime);
    if (!childResult.changed && !stepResult.changed && !nestedRuntimeChanged) continue;
    const children = childResult.items;
    const steps = stepResult.items;
    if (Array.isArray(run.children) || childResult.changed) run.children = children;
    if (Array.isArray(run.steps) || stepResult.changed) run.steps = steps;
    run.runtime = stripNestedRuntimeLogIds({
      ...(strippedRuntime || {}),
      ...(childResult.changed ? { children: clone(children) } : {}),
      ...(stepResult.changed ? { steps: clone(steps) } : {}),
      updatedAt: stamp
    }, removed);
    const items = children || steps || [];
    const required = items.filter((item) => item.required !== false);
    const satisfied = required.every((item) => ["COMPLETED", "EXCUSED", "NOT_APPLICABLE"].includes(item.state));
    if (!satisfied && ["COMPLETED", "READY_TO_FINISH"].includes(run.status)) {
      run.status = items.some((item) => ["IN_PROGRESS", "COMPLETED", "EXCUSED", "NOT_APPLICABLE"].includes(item.state))
        ? "IN_PROGRESS"
        : "NOT_STARTED";
      run.finishedAt = null;
    }
    run.updatedAt = stamp;
    affectedRuns.push(run.id);
  }
  return affectedRuns;
}

export function removeActionLogsInState(state, ids, now = new Date()) {
  const removed = new Set(ids || []);
  const affectedOccurrences = (state.occurrences || []).filter((occurrence) => (occurrence.logIds || []).some((id) => removed.has(id)));
  state.actionLogs = (state.actionLogs || []).filter((log) => !removed.has(log.id));
  for (const occurrence of state.occurrences || []) occurrence.logIds = (occurrence.logIds || []).filter((id) => !removed.has(id));
  const affectedRuns = refreshRunsAfterLogRemoval(state, removed, now);
  for (const occurrence of affectedOccurrences) {
    if (["skipped", "excused", "not_applicable"].includes(occurrence.status)) continue;
    const relationship = (state.blocks || []).flatMap((block) => block.relationships || []).find((item) => item.id === occurrence.relationshipId);
    const action = relationship?.kind === "action" ? (state.actions || []).find((item) => item.id === relationship.refId) : null;
    // Completion is derived from retained logs. Re-open a completed
    // occurrence for an explicit log deletion, while preserving the
    // occurrence's factual snapshot and all other history.
    const candidate = occurrence.status === "completed" ? { ...occurrence, status: "due" } : occurrence;
    occurrence.status = resolveOccurrenceStatus({
      occurrence: candidate,
      logs: state.actionLogs,
      action,
      now,
      unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy || relationship?.config?.unfinishedPolicy || "expire"
    });
    occurrence.updatedAt = now.toISOString();
  }
  return { affectedOccurrences, affectedRuns };
}

function removeLogs(state, ids, now = new Date()) {
  return removeActionLogsInState(state, ids, now);
}

const RUNTIME_TYPES = ["activation", "run", "occurrence", "period", "targetEvaluation", "cycleSmallCycle", "cycleBigCycle", "actionLog", "review", "task", "quickTask", "history", "importHistory"];

function ensureRuntimeSelection(selections = []) {
  const result = [];
  const seen = new Set();
  for (const selection of selections || []) {
    if (!RUNTIME_TYPES.includes(selection?.type) || !selection?.id) throw new ValidationError("Only existing runtime/data records can be selected for exact deletion.");
    const key = `${selection.type}:${selection.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type: selection.type, id: selection.id });
  }
  if (!result.length) throw new ValidationError("Select at least one runtime/data record.");
  return result;
}

function runtimeRecord(state, type, id) {
  const collection = {
    activation: "activations", run: "runs", occurrence: "occurrences", period: "periods",
    targetEvaluation: "targetEvaluations", cycleSmallCycle: "cycleSmallCycles", cycleBigCycle: "cycleBigCycles",
    actionLog: "actionLogs", review: "reviews", task: "tasks", quickTask: "quickTasks",
    history: "history", importHistory: "importHistory"
  }[type];
  return collection ? (state[collection] || []).find((item) => item.id === id) || null : null;
}

export function getRuntimeDeletionImpact(state = {}, selections = []) {
  const selected = ensureRuntimeSelection(selections);
  const missing = selected.filter((selection) => !runtimeRecord(state, selection.type, selection.id));
  if (missing.length) throw new NotFoundError(`Runtime record not found: ${missing.map((item) => `${item.type}:${item.id}`).join(", ")}`);
  const ids = (type) => new Set(selected.filter((selection) => selection.type === type).map((selection) => selection.id));
  const logIds = ids("actionLog");
  const occurrenceIds = ids("occurrence");
  const runIds = ids("run");
  const periodIds = ids("period");
  const actionLogs = (state.actionLogs || []).filter((log) => logIds.has(log.id));
  const referencedByLogs = {
    occurrences: (state.occurrences || []).filter((occurrence) => occurrenceIds.has(occurrence.id) && (occurrence.logIds || []).length).length,
    runs: actionLogs.filter((log) => (log.contextRefs || []).some((reference) => runIds.has(reference.runId))).length,
    occurrencesFromLogs: actionLogs.filter((log) => (log.contextRefs || []).some((reference) => occurrenceIds.has(reference.occurrenceId))).length,
    targetPeriods: periodIds.size ? (state.targetEvaluations || []).filter((evaluation) => periodIds.has(evaluation.periodId)).length : 0
  };
  return {
    selections: selected,
    counts: Object.fromEntries(RUNTIME_TYPES.map((type) => [type, selected.filter((item) => item.type === type).length])),
    factualActionLogsDeleted: logIds.size,
    occurrenceReferencesRemoved: referencedByLogs.occurrences + referencedByLogs.occurrencesFromLogs,
    runReferencesRemoved: referencedByLogs.runs,
    targetEvaluationsDeleted: referencedByLogs.targetPeriods,
    historyRecordsDeleted: ids("history").size,
    warnings: [
      logIds.size ? "Selected Action Logs are factual records; dependent occurrence progress will be recalculated." : null,
      runIds.size ? "Run context will be detached from retained Action Logs." : null,
      occurrenceIds.size ? "Selected Occurrences will be removed without deleting their Action Logs." : null,
      periodIds.size ? "Selected Target Period history and its evaluations will be removed." : null
    ].filter(Boolean)
  };
}

export function permanentlyDeleteRuntimeRecordsInState(state, selections, { now = new Date() } = {}) {
  const selected = ensureRuntimeSelection(selections);
  const impact = getRuntimeDeletionImpact(state, selected);
  const byType = (type) => new Set(selected.filter((item) => item.type === type).map((item) => item.id));
  const activationIds = byType("activation");
  const runIds = byType("run");
  const occurrenceIds = byType("occurrence");
  const periodIds = byType("period");
  const evaluationIds = byType("targetEvaluation");
  const smallIds = byType("cycleSmallCycle");
  const bigIds = byType("cycleBigCycle");
  const logIds = byType("actionLog");
  const reviewIds = byType("review");
  const taskIds = byType("task");
  const quickTaskIds = byType("quickTask");
  const historyIds = byType("history");
  const importIds = byType("importHistory");

  state.activations = (state.activations || []).filter((item) => !activationIds.has(item.id));
  for (const run of state.runs || []) if (activationIds.has(run.activationId)) {
    run.activationSnapshot = run.activationSnapshot || { id: run.activationId, label: run.label || run.id };
    run.activationId = null;
  }
  state.runs = (state.runs || []).filter((item) => !runIds.has(item.id));
  for (const log of state.actionLogs || []) log.contextRefs = (log.contextRefs || []).filter((reference) => !runIds.has(reference.runId));
  state.occurrences = (state.occurrences || []).filter((item) => !occurrenceIds.has(item.id));
  for (const log of state.actionLogs || []) log.contextRefs = (log.contextRefs || []).filter((reference) => !occurrenceIds.has(reference.occurrenceId));
  removeLogs(state, [...logIds], now);
  state.periods = (state.periods || []).filter((item) => !periodIds.has(item.id));
  state.targetEvaluations = (state.targetEvaluations || []).filter((item) => !evaluationIds.has(item.id) && !periodIds.has(item.periodId));
  state.cycleSmallCycles = (state.cycleSmallCycles || []).filter((item) => !smallIds.has(item.id));
  state.cycleBigCycles = (state.cycleBigCycles || []).filter((item) => !bigIds.has(item.id)).map((item) => ({
    ...item,
    smallCycles: (item.smallCycles || []).filter((small) => !smallIds.has(small.id)),
    resolutions: (item.resolutions || []).filter((resolution) => !smallIds.has(resolution.smallCycleId))
  }));
  for (const block of state.blocks || []) if (block.type === "cycle") {
    if (smallIds.has(block.config?.currentSmallCycleId)) block.config = { ...(block.config || {}), currentSmallCycleId: null, currentSlot: -1 };
    if (bigIds.has(block.config?.currentBigCycleId)) block.config = { ...(block.config || {}), currentBigCycleId: null };
  }
  state.reviews = (state.reviews || []).filter((item) => !reviewIds.has(item.id));
  state.tasks = (state.tasks || []).filter((item) => !taskIds.has(item.id));
  state.quickTasks = (state.quickTasks || []).filter((item) => !quickTaskIds.has(item.id));
  state.history = (state.history || []).filter((item) => !historyIds.has(item.id));
  state.importHistory = (state.importHistory || []).filter((item) => !importIds.has(item.id));
  validateManagedState(state);
  return { ...impact, deleted: selected };
}

export function clearDataInState(state, options = {}) {
  const categories = new Set(options.categories || []); if (!categories.size) throw new ValidationError("Choose at least one data category to clear.");
  const filter = { ...options, search: options.search || "", type: "all", weekStartsOn: options.weekStartsOn ?? state.settings?.weekStartsOn };
  const result = { activations: 0, actionLogs: 0, runs: 0, occurrences: 0, periods: 0, cycleRuntime: 0, reviews: 0, tasks: 0, definitions: 0, history: 0, settings: 0 };
  if (categories.has("activations")) {
    const ids = new Set(filteredIds(state, "activation", filter));
    state.activations = (state.activations || []).filter((activation) => !ids.has(activation.id));
    for (const run of state.runs || []) if (ids.has(run.activationId)) {
      run.activationSnapshot = run.activationSnapshot || { id: run.activationId, label: run.label || run.id };
      run.activationId = null;
    }
    result.activations = ids.size;
  }
  if (categories.has("actionLogs")) { const ids = filteredIds(state, "actionLog", filter); removeLogs(state, ids, options.now || new Date()); result.actionLogs = ids.length; }
  if (categories.has("runs")) { const ids = new Set(filteredIds(state, "run", filter)); state.runs = (state.runs || []).filter((run) => !ids.has(run.id)); for (const log of state.actionLogs || []) log.contextRefs = (log.contextRefs || []).filter((reference) => !ids.has(reference.runId)); result.runs = ids.size; }
  if (categories.has("occurrences")) { const ids = new Set(filteredIds(state, "occurrence", filter)); state.occurrences = (state.occurrences || []).filter((occurrence) => !ids.has(occurrence.id)); for (const log of state.actionLogs || []) log.contextRefs = (log.contextRefs || []).filter((reference) => !ids.has(reference.occurrenceId)); result.occurrences = ids.size; }
  if (categories.has("targetPeriodHistory")) { const ids = new Set((state.periods || []).filter((period) => period.status === "closed" && filteredIds(state, "period", filter).includes(period.id)).map((period) => period.id)); state.periods = (state.periods || []).filter((period) => !ids.has(period.id)); state.targetEvaluations = (state.targetEvaluations || []).filter((evaluation) => !ids.has(evaluation.periodId)); result.periods = ids.size; }
  if (categories.has("cycleRuntimeHistory")) {
    const smallIds = new Set(filteredIds(state, "cycleSmallCycle", filter)); const bigIds = new Set(filteredIds(state, "cycleBigCycle", filter));
    result.cycleRuntime = smallIds.size + bigIds.size;
    state.cycleSmallCycles = (state.cycleSmallCycles || []).filter((item) => !smallIds.has(item.id));
    state.cycleBigCycles = (state.cycleBigCycles || []).filter((item) => !bigIds.has(item.id)).map((item) => ({ ...item, smallCycles: (item.smallCycles || []).filter((small) => !smallIds.has(small.id)), resolutions: (item.resolutions || []).filter((resolution) => !smallIds.has(resolution.smallCycleId)) }));
    for (const block of state.blocks || []) if (block.type === "cycle" && (smallIds.has(block.config?.currentSmallCycleId) || bigIds.has(block.config?.currentBigCycleId))) block.config = { ...(block.config || {}), currentSmallCycleId: null, currentBigCycleId: null };
  }
  if (categories.has("reviews")) { const ids = new Set(filteredIds(state, "review", filter)); state.reviews = (state.reviews || []).filter((item) => !ids.has(item.id)); result.reviews = ids.size; }
  if (categories.has("tasks")) { const taskIds = new Set(filteredIds(state, "task", filter)); const quickIds = new Set(filteredIds(state, "quickTask", filter)); state.tasks = (state.tasks || []).filter((item) => !taskIds.has(item.id)); state.quickTasks = (state.quickTasks || []).filter((item) => !quickIds.has(item.id)); result.tasks = taskIds.size + quickIds.size; }
  if (categories.has("definitions")) {
    // Remove relationship-bearing definitions first so Category deletion is
    // not blocked by Tags that are part of the same explicit clear request.
    const definitionOrder = ["block", "action", "tag", "category", "unit"];
    const selections = definitionOrder.flatMap((type) => filteredIds(state, type, filter).filter((id) => !(type === "unit" && findDefinition(state, type, id)?.builtIn)).map((id) => ({ type, id })));
    result.definitions = selections.length;
    moveDefinitionsToBinInState(state, selections, { now: options.now || new Date(), removeLiveRelationships: true });
  }
  if (categories.has("history")) { const ids = new Set(filteredIds(state, "history", filter)); state.history = (state.history || []).filter((event) => !ids.has(event.id)); result.history = ids.size; }
  if (categories.has("settings")) { const fresh = createEmptyState(options.now || new Date()); state.settings = clone(fresh.settings); result.settings = 1; }
  validateManagedState(state); return result;
}
