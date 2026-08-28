import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { clone, normalizedKey } from "../shared/validation.js";
import { createAction, validateAction, versionResultFields } from "../domain/actions.js";
import { createCategory, createTag, validateTaxonomy } from "../domain/taxonomy.js";
import { createUnit, validateUnits } from "../domain/units.js";
import { createResultField, validateResultFields } from "../domain/results.js";
import { createActionLog } from "../domain/logs.js";
import { createBlock, setDefinitionStatus, isRunCapableBlockType } from "../domain/blocks.js";
import { createRelationship, validateBlockGraph } from "../domain/relationships.js";
import { createOccurrence } from "../domain/occurrences.js";
import { resolveOccurrenceStatus } from "../domain/occurrences.js";
import { createRun, startRun as startDomainRun, finishRun as finishDomainRun, pauseRun as pauseDomainRun, resumeRun as resumeDomainRun, cancelRun as cancelDomainRun } from "../domain/runs.js";
import { returnToWorkflowStep as returnToDomainWorkflowStep } from "../domain/workflows.js";
import { createActivation, pauseActivation as pauseDomainActivation, resumeActivation as resumeDomainActivation } from "../domain/activations.js";
import { advanceCyclePosition, createBigCycleRuntime, generateNextSmallCycle } from "../domain/cycles.js";
import { appendHistory } from "../domain/history.js";
import { domainEvent, EVENT_TYPES } from "./events.js";
import { importPackage } from "../import-export/importer.js";

const TERMINAL_OCCURRENCES = ["completed", "skipped", "missed", "expired", "excused", "not_applicable"];

export function createCommands(repository, { clock = () => new Date(), idFactory = null } = {}) {
  const now = () => new Date(clock());
  const makeId = (prefix) => idFactory?.(prefix) || `${prefix}_${now().getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  function addHistory(event) {
    const state = repository.getState();
    state.history = appendHistory(state.history || [], { ...event, timestamp: event.timestamp || now() });
  }
  function emit(type, payload) {
    const state = repository.getState();
    state.meta = state.meta || {};
    state.meta.events = [...(state.meta.events || []), domainEvent(type, payload, now())].slice(-500);
  }
  function touch() { repository.getState().updatedAt = now().toISOString(); }
  function commandWasApplied(commandId) {
    if (!commandId) return false;
    const state = repository.getState();
    state.meta = state.meta || {};
    state.meta.appliedCommandIds = state.meta.appliedCommandIds || [];
    if (state.meta.appliedCommandIds.includes(commandId)) return true;
    state.meta.appliedCommandIds.push(commandId);
    state.meta.appliedCommandIds = state.meta.appliedCommandIds.slice(-1000);
    return false;
  }
  function ensureUnique(collection, item, label) {
    if (collection.some((candidate) => candidate.id !== item.id && normalizedKey(candidate.name) === normalizedKey(item.name))) throw new ConflictError(`${label} name already exists.`);
  }
  function requireStateItem(collection, id, label) {
    const index = collection.findIndex((item) => item.id === id);
    if (index < 0) throw new NotFoundError(`${label} not found: ${id}`);
    return { index, item: collection[index] };
  }
  function replaceAt(collection, index, value) { collection[index] = value; return value; }

  return {
    createCategory(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const category = createCategory({ ...input, id: input.id || makeId("category"), now: now() });
        ensureUnique(state.categories, category, "Category"); state.categories.push(category); validateTaxonomy(state); touch();
        addHistory({ type: "definition", description: `Created Category: ${category.name}`, objectType: "category", objectId: category.id }); return clone(category);
      });
    },
    updateCategory(id, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: before } = requireStateItem(state.categories, id, "Category"); const next = { ...before, ...clone(patch), id, updatedAt: now().toISOString() };
        ensureUnique(state.categories, next, "Category"); validateTaxonomy({ ...state, categories: state.categories.map((category, current) => current === index ? next : category) }); replaceAt(state.categories, index, next); touch();
        addHistory({ type: "definition", description: `Updated Category: ${next.name}`, objectType: "category", objectId: id, snapshots: { before: clone(before), after: clone(next) } }); return clone(next);
      });
    },
    archiveCategory(id) { return this.updateCategory(id, { status: "archived" }); },
    createTag(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const tag = createTag({ ...input, id: input.id || makeId("tag"), now: now() }, state.categories);
        if (state.tags.some((candidate) => candidate.categoryId === tag.categoryId && normalizedKey(candidate.name) === normalizedKey(tag.name))) throw new ConflictError("Tag name already exists in that Category."); state.tags.push(tag); validateTaxonomy(state); touch();
        addHistory({ type: "definition", description: `Created Tag: ${tag.name}`, objectType: "tag", objectId: tag.id }); return clone(tag);
      });
    },
    updateTag(id, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: before } = requireStateItem(state.tags, id, "Tag"); const next = { ...before, ...clone(patch), id, updatedAt: now().toISOString() };
        const candidate = state.tags.map((tag, current) => current === index ? next : tag); validateTaxonomy({ ...state, tags: candidate }); replaceAt(state.tags, index, next); touch();
        addHistory({ type: "definition", description: `Updated Tag: ${next.name}`, objectType: "tag", objectId: id, snapshots: { before: clone(before), after: clone(next) } }); return clone(next);
      });
    },
    archiveTag(id) { return this.updateTag(id, { status: "archived" }); },
    createUnit(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const unit = createUnit({ ...input, id: input.id || makeId("unit"), now: now() });
        if (state.units.some((candidate) => candidate.name.toLocaleLowerCase() === unit.name.toLocaleLowerCase() || candidate.symbol.toLocaleLowerCase() === unit.symbol.toLocaleLowerCase() || candidate.id === unit.id)) throw new ConflictError("Unit name, symbol or ID already exists.");
        validateUnits([...state.units, unit]); state.units.push(unit); touch(); addHistory({ type: "definition", description: `Created Unit: ${unit.name}`, objectType: "unit", objectId: unit.id }); return clone(unit);
      });
    },
    updateUnit(id, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: before } = requireStateItem(state.units, id, "Unit"); if (before.builtIn) throw new ConflictError("Built-in Units cannot be edited; create a custom Unit instead.");
        const next = { ...before, ...clone(patch), id, updatedAt: now().toISOString() }; if (state.units.some((unit, current) => current !== index && (unit.name.toLocaleLowerCase() === String(next.name).toLocaleLowerCase() || unit.symbol.toLocaleLowerCase() === String(next.symbol).toLocaleLowerCase()))) throw new ConflictError("Unit name or symbol already exists.");
        validateUnits(state.units.map((unit, current) => current === index ? next : unit)); replaceAt(state.units, index, next); touch(); addHistory({ type: "definition", description: `Updated Unit: ${next.name}`, objectType: "unit", objectId: id, snapshots: { before: clone(before), after: clone(next) } }); return clone(next);
      });
    },
    archiveUnit(id) { return this.updateUnit(id, { status: "archived" }); },
    createAction(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const action = createAction({ ...input, id: input.id || makeId("action"), now: now() }, { units: state.units, tags: state.tags, categories: state.categories });
        validateAction(action, { units: state.units, tags: state.tags, categories: state.categories }); ensureUnique(state.actions, action, "Action"); state.actions.push(action); touch(); addHistory({ type: "definition", description: `Created Action: ${action.name}`, objectType: "action", objectId: action.id }); emit(EVENT_TYPES.DEFINITION_CHANGED, { objectType: "action", objectId: action.id }); return clone(action);
      });
    },
    updateAction(id, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: before } = requireStateItem(state.actions, id, "Action"); const next = { ...before, ...clone(patch), id, resultFields: patch.resultFields ? versionResultFields(before.resultFields || [], patch.resultFields, now()) : before.resultFields, updatedAt: now().toISOString() };
        ensureUnique(state.actions, next, "Action"); validateAction(next, { units: state.units, tags: state.tags, categories: state.categories }); replaceAt(state.actions, index, next); touch(); addHistory({ type: "definition", description: `Updated Action: ${next.name}`, objectType: "action", objectId: id, snapshots: { before: clone(before), after: clone(next) } }); emit(EVENT_TYPES.DEFINITION_CHANGED, { objectType: "action", objectId: id }); return clone(next);
      });
    },
    archiveAction(id) { return this.updateAction(id, { status: "archived" }); },
    addResultField(actionId, input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index } = requireStateItem(state.actions, actionId, "Action"); const action = state.actions[index]; if ((action.resultFields || []).length >= 10) throw new ValidationError("An Action may have at most 10 Result Fields.");
        const field = createResultField({ ...input, id: input.id || makeId("result"), position: input.position ?? action.resultFields.length, now: now() }); const next = { ...action, resultFields: [...(action.resultFields || []), field], updatedAt: now().toISOString() }; validateResultFields(next.resultFields, state.units);
        if (field.resultTagId && !state.tags.some((tag) => tag.id === field.resultTagId && ["result", "both"].includes(tag.scope))) throw new ValidationError("Result Field references an invalid Result Tag."); replaceAt(state.actions, index, next); touch(); addHistory({ type: "definition", description: `Added Result Field: ${field.label}`, objectType: "resultField", objectId: field.id, snapshots: { actionId, field: clone(field) } }); emit(EVENT_TYPES.DEFINITION_CHANGED, { objectType: "resultField", objectId: field.id }); return clone(field);
      });
    },
    updateResultField(actionId, fieldId, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index } = requireStateItem(state.actions, actionId, "Action"); const action = state.actions[index]; const before = (action.resultFields || []).find((field) => field.id === fieldId); if (!before) throw new NotFoundError(`Result Field not found: ${fieldId}`);
        const candidate = { ...before, ...clone(patch), id: fieldId }; const nextFields = versionResultFields(action.resultFields || [], action.resultFields.map((field) => field.id === fieldId ? candidate : field), now()); validateResultFields(nextFields, state.units); if (candidate.resultTagId && !state.tags.some((tag) => tag.id === candidate.resultTagId && ["result", "both"].includes(tag.scope))) throw new ValidationError("Result Field references an invalid Result Tag.");
        const next = { ...action, resultFields: nextFields, updatedAt: now().toISOString() }; replaceAt(state.actions, index, next); touch(); addHistory({ type: "definition", description: `Updated Result Field: ${candidate.label || before.label}`, objectType: "resultField", objectId: fieldId, snapshots: { actionId, before: clone(before), after: clone(nextFields.find((field) => field.id === fieldId)) } }); emit(EVENT_TYPES.DEFINITION_CHANGED, { objectType: "resultField", objectId: fieldId }); return clone(nextFields.find((field) => field.id === fieldId));
      });
    },
    removeResultField(actionId, fieldId) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index } = requireStateItem(state.actions, actionId, "Action"); const action = state.actions[index]; const field = (action.resultFields || []).find((candidate) => candidate.id === fieldId); if (!field) throw new NotFoundError(`Result Field not found: ${fieldId}`);
        replaceAt(state.actions, index, { ...action, resultFields: action.resultFields.filter((candidate) => candidate.id !== fieldId), updatedAt: now().toISOString() }); touch(); addHistory({ type: "definition", description: `Archived Result Field: ${field.label}`, objectType: "resultField", objectId: fieldId, snapshots: { actionId, field: clone(field) } }); return clone(field);
      });
    },
    createBlock(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const block = createBlock({ ...input, id: input.id || makeId("block"), now: now() }); ensureUnique(state.blocks, block, "Block"); validateBlockGraph({ blocks: [...state.blocks, block], actions: state.actions }); state.blocks.push(block); touch(); addHistory({ type: "definition", description: `Created ${block.type} Block: ${block.name}`, objectType: "block", objectId: block.id }); return clone(block);
      });
    },
    updateBlock(id, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: before } = requireStateItem(state.blocks, id, "Block"); const next = { ...before, ...clone(patch), id, updatedAt: now().toISOString() }; ensureUnique(state.blocks, next, "Block"); validateBlockGraph({ blocks: state.blocks.map((block, current) => current === index ? next : block), actions: state.actions }); replaceAt(state.blocks, index, next); touch();
        if (before.type === "project" && JSON.stringify(before.config || {}) !== JSON.stringify(next.config || {})) { const activeRuns = (state.runs || []).filter((run) => run.blockId === id && !["COMPLETED", "CANCELLED", "MISSED"].includes(run.status)); if (activeRuns.length) state.scopeChangeEvents = [...(state.scopeChangeEvents || []), { id: makeId("scope_change"), blockId: id, runIds: activeRuns.map((run) => run.id), changedAt: now().toISOString(), before: clone(before.config), after: clone(next.config) }]; }
        addHistory({ type: "definition", description: `Updated Block: ${next.name}`, objectType: "block", objectId: id, snapshots: { before: clone(before), after: clone(next) } }); emit(EVENT_TYPES.DEFINITION_CHANGED, { objectType: "block", objectId: id }); return clone(next);
      });
    },
    setBlockStatus(id, status) { return repository.transaction(() => { const state = repository.getState(); const { index, item: before } = requireStateItem(state.blocks, id, "Block"); const next = setDefinitionStatus(before, status, now()); replaceAt(state.blocks, index, next); touch(); addHistory({ type: "definition", description: `${status} Block: ${next.name}`, objectType: "block", objectId: id, snapshots: { before: clone(before), after: clone(next) } }); emit(status === "ACTIVE" ? EVENT_TYPES.BLOCK_ACTIVATED : EVENT_TYPES.BLOCK_PAUSED, { blockId: id, status }); return clone(next); }); },
    activateBlock(id) { return this.setBlockStatus(id, "ACTIVE"); },
    pauseBlock(id) { return this.setBlockStatus(id, "PAUSED"); },
    addRelationship(parentBlockId, input = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: parent } = requireStateItem(state.blocks, parentBlockId, "Block"); const relationship = createRelationship({ ...input, parentBlockId, position: input.position ?? parent.relationships.length, id: input.id || makeId("relationship"), now: now() }); const next = { ...parent, relationships: [...(parent.relationships || []), relationship], updatedAt: now().toISOString() }; validateBlockGraph({ blocks: state.blocks.map((block, current) => current === index ? next : block), actions: state.actions }); replaceAt(state.blocks, index, next); touch(); addHistory({ type: "definition", description: `Added relationship to ${parent.name}`, objectType: "relationship", objectId: relationship.id }); return clone(relationship);
      });
    },
    updateRelationship(parentBlockId, relationshipId, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: parent } = requireStateItem(state.blocks, parentBlockId, "Block"); const before = (parent.relationships || []).find((relationship) => relationship.id === relationshipId); if (!before) throw new NotFoundError(`Relationship not found: ${relationshipId}`); const nextRelationship = { ...before, ...clone(patch), id: relationshipId, parentBlockId, updatedAt: now().toISOString() }; const next = { ...parent, relationships: parent.relationships.map((relationship) => relationship.id === relationshipId ? nextRelationship : relationship), updatedAt: now().toISOString() }; validateBlockGraph({ blocks: state.blocks.map((block, current) => current === index ? next : block), actions: state.actions }); replaceAt(state.blocks, index, next); touch(); addHistory({ type: "definition", description: `Updated relationship in ${parent.name}`, objectType: "relationship", objectId: relationshipId, snapshots: { before: clone(before), after: clone(nextRelationship) } }); return clone(nextRelationship);
      });
    },
    removeRelationship(parentBlockId, relationshipId) { return repository.transaction(() => { const state = repository.getState(); const { index, item: parent } = requireStateItem(state.blocks, parentBlockId, "Block"); const removed = (parent.relationships || []).find((relationship) => relationship.id === relationshipId); if (!removed) throw new NotFoundError(`Relationship not found: ${relationshipId}`); replaceAt(state.blocks, index, { ...parent, relationships: parent.relationships.filter((relationship) => relationship.id !== relationshipId), updatedAt: now().toISOString() }); touch(); addHistory({ type: "definition", description: `Removed relationship from ${parent.name}`, objectType: "relationship", objectId: relationshipId, snapshots: { removed: clone(removed) } }); return clone(removed); }); },
    logAction(input = {}) {
      return repository.transaction(() => {
        if (commandWasApplied(input.commandId)) return clone(repository.getState().actionLogs.find((log) => log.commandId === input.commandId)); const state = repository.getState(); const action = state.actions.find((candidate) => candidate.id === input.actionId); if (!action) throw new NotFoundError(`Action not found: ${input.actionId}`); const log = createActionLog({ ...input, action, finalizing: Boolean(input.finalizing), now: now(), units: state.units }); if (state.actionLogs.some((candidate) => candidate.id === log.id)) throw new ConflictError(`Action Log ID already exists: ${log.id}`); for (const reference of log.contextRefs || []) { if (!reference.occurrenceId) continue; const occurrence = state.occurrences.find((item) => item.id === reference.occurrenceId); if (!occurrence) throw new NotFoundError(`Occurrence not found: ${reference.occurrenceId}`); const relationship = state.blocks.flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId); if (relationship?.kind === "action" && relationship.refId !== action.id) throw new ValidationError("Action Log cannot be attributed to an Occurrence for a different Action."); } if (input.commandId) log.commandId = input.commandId; state.actionLogs.push(log); for (const reference of log.contextRefs || []) { const occurrence = state.occurrences.find((item) => item.id === reference.occurrenceId); if (!occurrence) continue; if (!occurrence.logIds.includes(log.id)) occurrence.logIds.push(log.id); const beforeStatus = occurrence.status; const nextStatus = resolveOccurrenceStatus({ occurrence, logs: state.actionLogs, action, now: now(), unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy || "expire" }); if (nextStatus !== beforeStatus) { occurrence.status = nextStatus; occurrence.updatedAt = now().toISOString(); emit(nextStatus === "completed" ? EVENT_TYPES.OCCURRENCE_COMPLETED : EVENT_TYPES.OCCURRENCE_STATUS_CHANGED, { occurrenceId: occurrence.id, status: nextStatus }); } } touch(); addHistory({ type: "action_log", description: `Logged ${action.name}`, objectType: "actionLog", objectId: log.id, actionId: action.id, snapshots: { action: log.actionSnapshot, results: log.resultValues.map((entry) => entry.snapshot) } }); emit(EVENT_TYPES.ACTION_LOGGED, { actionLogId: log.id, actionId: action.id }); return clone(log);
      });
    },
    deleteActionLog(id) { return repository.transaction(() => { const state = repository.getState(); const { index, item: removed } = requireStateItem(state.actionLogs, id, "Action Log"); state.actionLogs.splice(index, 1); for (const occurrence of state.occurrences || []) occurrence.logIds = (occurrence.logIds || []).filter((logId) => logId !== id); touch(); addHistory({ type: "action_log", description: `Deleted Action Log: ${removed.actionSnapshot?.name || removed.actionId}`, objectType: "actionLog", objectId: id, metadata: { factualSnapshotPreserved: true }, snapshots: { deleted: removed } }); emit(EVENT_TYPES.ACTION_LOG_DELETED, { actionLogId: id }); return clone(removed); }); },
    createActivation(input = {}) { return repository.transaction(() => { const state = repository.getState(); if (!state.blocks.some((block) => block.id === input.blockId)) throw new NotFoundError(`Block not found: ${input.blockId}`); const activation = createActivation({ ...input, id: input.id || makeId("activation"), now: now() }); state.activations.push(activation); touch(); addHistory({ type: "activation", description: "Created activation", objectType: "activation", objectId: activation.id }); emit(EVENT_TYPES.BLOCK_ACTIVATED, { activationId: activation.id, blockId: activation.blockId }); return clone(activation); }); },
    pauseActivation(id, options = {}) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.activations, id, "Activation"); state.activations[index] = pauseDomainActivation(state.activations[index], { ...options, now: now() }); touch(); addHistory({ type: "activation", description: "Paused activation", objectType: "activation", objectId: id }); emit(EVENT_TYPES.BLOCK_PAUSED, { activationId: id }); return clone(state.activations[index]); }); },
    resumeActivation(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.activations, id, "Activation"); state.activations[index] = resumeDomainActivation(state.activations[index], now()); touch(); addHistory({ type: "activation", description: "Resumed activation", objectType: "activation", objectId: id }); emit(EVENT_TYPES.BLOCK_ACTIVATED, { activationId: id, blockId: state.activations[index].blockId }); return clone(state.activations[index]); }); },
    startRun(input = {}) { return repository.transaction(() => { const state = repository.getState(); const block = state.blocks.find((candidate) => candidate.id === input.blockId); if (!block) throw new NotFoundError(`Block not found: ${input.blockId}`); if (!isRunCapableBlockType(block.type)) throw new ValidationError(`${block.type} Blocks do not create Runs.`); const run = startDomainRun(createRun({ ...input, id: input.id || makeId("run"), now: now(), snapshot: input.snapshot || { block: clone(block) } }), now()); state.runs.push(run); touch(); addHistory({ type: "run", description: `Started ${block.name}`, objectType: "run", objectId: run.id, snapshots: { run: run.snapshot } }); emit(EVENT_TYPES.RUN_STARTED, { runId: run.id, blockId: block.id }); return clone(run); }); },
    finishRun(id, status = "COMPLETED") { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.runs, id, "Run"); state.runs[index] = finishDomainRun(state.runs[index], status, now()); touch(); addHistory({ type: "run", description: `Finished Run (${status})`, objectType: "run", objectId: id }); emit(EVENT_TYPES.RUN_FINISHED, { runId: id, status }); return clone(state.runs[index]); }); },
    pauseRun(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.runs, id, "Run"); state.runs[index] = pauseDomainRun(state.runs[index], now()); touch(); addHistory({ type: "run", description: "Paused Run", objectType: "run", objectId: id }); emit(EVENT_TYPES.RUN_PAUSED, { runId: id }); return clone(state.runs[index]); }); },
    resumeRun(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.runs, id, "Run"); state.runs[index] = resumeDomainRun(state.runs[index], now()); touch(); addHistory({ type: "run", description: "Resumed Run", objectType: "run", objectId: id }); emit(EVENT_TYPES.RUN_RESUMED, { runId: id }); return clone(state.runs[index]); }); },
    returnToWorkflowStep(runId, stepId) {
      return repository.transaction(() => {
        const state = repository.getState(); const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const steps = Array.isArray(run.steps) ? run.steps : Array.isArray(run.snapshot?.steps) ? run.snapshot.steps : null;
        if (!steps) throw new ValidationError("This Workflow Run has no runtime steps.");
        const nextSteps = returnToDomainWorkflowStep({ steps, stepId, now: now() });
        state.runs[index] = { ...run, steps: nextSteps, currentStepId: stepId, updatedAt: now().toISOString() };
        touch(); addHistory({ type: "workflow", description: `Returned Workflow Run to step ${stepId}`, objectType: "run", objectId: runId, metadata: { stepId, downstreamReopened: true } }); emit(EVENT_TYPES.DEFINITION_CHANGED, { runId, workflowStepId: stepId, transition: "RETURN_TO_STEP" }); return clone(state.runs[index]);
      });
    },
    cancelRun(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.runs, id, "Run"); state.runs[index] = cancelDomainRun(state.runs[index], now()); touch(); addHistory({ type: "run", description: "Cancelled Run", objectType: "run", objectId: id }); emit(EVENT_TYPES.RUN_FINISHED, { runId: id, status: "CANCELLED" }); return clone(state.runs[index]); }); },
    createOccurrence(input = {}) { return repository.transaction(() => { const state = repository.getState(); const occurrence = createOccurrence({ ...input, id: input.id || makeId("occurrence"), now: now() }); const duplicate = state.occurrences.find((item) => item.id === occurrence.id || occurrence.scheduledAt != null && item.relationshipId === occurrence.relationshipId && item.scheduledAt === occurrence.scheduledAt); if (duplicate) return clone(duplicate); state.occurrences.push(occurrence); touch(); emit(EVENT_TYPES.OCCURRENCE_CREATED, { occurrenceId: occurrence.id }); return clone(occurrence); }); },
    completeOccurrence(id) { return this.resolveOccurrence(id, "completed"); },
    skipOccurrence(id, reason = "") { return this.resolveOccurrence(id, "skipped", reason); },
    resolveOccurrence(id, status, reason = "") { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.occurrences, id, "Occurrence"); const occurrence = state.occurrences[index]; if (!TERMINAL_OCCURRENCES.includes(status)) throw new ValidationError("Occurrence status is invalid."); const relationship = state.blocks.flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId); if (status === "skipped" && relationship?.config?.allowSkip !== true) throw new ValidationError("Skipping this occurrence is not allowed for this relationship."); if (status === "skipped" && relationship?.config?.requireSkipReason && !String(reason || "").trim()) throw new ValidationError("A skip reason is required."); state.occurrences[index] = { ...occurrence, status, reason: reason || null, updatedAt: now().toISOString() }; touch(); addHistory({ type: "occurrence", description: `${status} occurrence`, objectType: "occurrence", objectId: id, metadata: { reason } }); emit(status === "completed" ? EVENT_TYPES.OCCURRENCE_COMPLETED : status === "missed" ? EVENT_TYPES.OCCURRENCE_MISSED : EVENT_TYPES.OCCURRENCE_STATUS_CHANGED, { occurrenceId: id, status }); return clone(state.occurrences[index]); }); },
    advanceCycle(id, steps = 1) { return repository.transaction(() => { const state = repository.getState(); const { index, item: cycle } = requireStateItem(state.blocks, id, "Cycle"); if (cycle.type !== "cycle") throw new ValidationError("Block is not a Cycle."); const next = advanceCyclePosition(cycle, { steps, now: now() }); replaceAt(state.blocks, index, next); touch(); addHistory({ type: "cycle", description: `Advanced Cycle: ${cycle.name}`, objectType: "block", objectId: id, snapshots: { from: cycle.config?.currentPosition || cycle.currentPosition || 0, to: next.config?.currentPosition || 0 } }); emit(EVENT_TYPES.CYCLE_ADVANCED, { cycleId: id, position: next.config?.currentPosition || 0 }); return clone(next); }); },
    generateCycleSmallCycle(id) { return repository.transaction(() => { const state = repository.getState(); const { index, item: cycle } = requireStateItem(state.blocks, id, "Cycle"); if (cycle.type !== "cycle") throw new ValidationError("Block is not a Cycle."); let big = (state.cycleBigCycles || []).find((item) => item.cycleId === id && item.status === "open"); if (!big) { big = createBigCycleRuntime({ cycleId: id, relationships: cycle.relationships || [], smallCycleSize: cycle.config?.smallCycleSize || null, fairness: cycle.config?.fairness || {}, config: cycle.config, now: now() }); state.cycleBigCycles.push(big); } const small = generateNextSmallCycle({ bigCycle: big, relationships: cycle.relationships || [], now: now() }); state.cycleSmallCycles.push(small); big.smallCycles = [...(big.smallCycles || []), { id: small.id, sequence: small.slots, generatedAt: small.generatedAt }]; big.fairness = small.fairness; big.appearanceCoverage = small.coverage; if (big.participantRelationshipIds.every((relationshipId) => big.appearanceCoverage.includes(relationshipId))) { big.status = "completed"; big.completedAt = now().toISOString(); } state.blocks[index] = { ...cycle, config: { ...(cycle.config || {}), currentSmallCycleId: small.id }, updatedAt: now().toISOString() }; touch(); addHistory({ type: "cycle", description: `Generated Small Cycle: ${cycle.name}`, objectType: "cycleSmallCycle", objectId: small.id, snapshots: { sequence: small.slots } }); return clone(small); }); },
    closePeriod(id, evaluation) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.periods, id, "Period"); const period = state.periods[index]; if (period.status === "closed") return clone(period); const closed = { ...period, status: "closed", closedAt: now().toISOString(), evaluation: clone(evaluation) }; state.periods[index] = closed; if (!state.targetEvaluations.some((item) => item.periodId === id)) state.targetEvaluations.push({ id: `${id}:evaluation`, periodId: id, ownerId: period.ownerId, evaluation: clone(evaluation), closedAt: closed.closedAt, snapshot: clone(period.snapshot) }); touch(); addHistory({ type: "period", description: "Closed evaluation period", objectType: "period", objectId: id, snapshots: { evaluation } }); emit(EVENT_TYPES.PERIOD_CLOSED, { periodId: id }); return clone(closed); }); },
    updateSettings(patch = {}) { return repository.transaction(() => { const state = repository.getState(); state.settings = { ...(state.settings || {}), ...clone(patch), defaults: { ...(state.settings?.defaults || {}), ...(patch.defaults || {}) }, capacity: { ...(state.settings?.capacity || {}), ...(patch.capacity || {}) } }; touch(); addHistory({ type: "settings", description: "Updated Settings", objectType: "settings", snapshots: { patch: clone(patch) } }); return clone(state.settings); }); },
    setPrimaryProject(id) { return this.updateSettings({ primaryProjectId: id || null }); },
    createTask(input = {}) { return repository.transaction(() => { const state = repository.getState(); const task = { id: input.id || makeId("task"), name: String(input.name || "").trim(), actionId: input.actionId || null, type: input.type || "one_time", targetDate: input.targetDate || null, status: input.status || "active", notes: String(input.notes || ""), createdAt: new Date(input.createdAt || now()).toISOString(), resolvedAt: null }; if (!task.name) throw new ValidationError("Task name is required."); state.tasks.push(task); touch(); addHistory({ type: "task", description: `Created Task: ${task.name}`, objectType: "task", objectId: task.id }); return clone(task); }); },
    completeTask(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.tasks, id, "Task"); state.tasks[index] = { ...state.tasks[index], status: "completed", resolvedAt: now().toISOString() }; touch(); addHistory({ type: "task", description: `Completed Task: ${state.tasks[index].name}`, objectType: "task", objectId: id }); return clone(state.tasks[index]); }); },
    updateTask(id, patch = {}) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.tasks, id, "Task"); state.tasks[index] = { ...state.tasks[index], ...clone(patch), id, updatedAt: now().toISOString() }; touch(); return clone(state.tasks[index]); }); },
    createQuickTask(input = {}) { return repository.transaction(() => { const state = repository.getState(); const task = { id: input.id || makeId("quick_task"), name: String(input.name || "").trim(), date: input.date || null, time: input.time || null, deadline: input.deadline || null, status: input.status || "active", createdAt: new Date(input.createdAt || now()).toISOString(), resolvedAt: null }; if (!task.name) throw new ValidationError("Quick task name is required."); state.quickTasks.push(task); touch(); addHistory({ type: "task", description: `Created Quick Task: ${task.name}`, objectType: "quickTask", objectId: task.id }); return clone(task); }); },
    completeQuickTask(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.quickTasks, id, "Quick Task"); state.quickTasks[index] = { ...state.quickTasks[index], status: "completed", resolvedAt: now().toISOString() }; touch(); return clone(state.quickTasks[index]); }); },
    createReview(input = {}) { return repository.transaction(() => { const state = repository.getState(); const review = { id: input.id || makeId("review"), name: String(input.name || "").trim(), date: input.date || now().toISOString().slice(0, 10), notes: String(input.notes || ""), status: input.status || "draft", createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), completedAt: null }; if (!review.name) throw new ValidationError("Review name is required."); state.reviews.push(review); touch(); addHistory({ type: "review", description: `Created Review: ${review.name}`, objectType: "review", objectId: review.id }); return clone(review); }); },
    updateReview(id, patch = {}) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.reviews, id, "Review"); state.reviews[index] = { ...state.reviews[index], ...clone(patch), id, updatedAt: now().toISOString() }; touch(); return clone(state.reviews[index]); }); },
    completeReview(id) { return this.updateReview(id, { status: "completed", completedAt: now().toISOString() }); },
    importPackage(packageValue, options = {}) { return repository.transaction(() => { const state = repository.getState(); const result = importPackage(packageValue, { ...options, existingState: state, now: now() }); const next = result.state; next.meta = next.meta || {}; next.meta.restorePoints = [...(next.meta.restorePoints || []), { createdAt: now().toISOString(), state: clone(result.restorePoint) }].slice(-5); repository.replaceState(next, { persist: false }); addHistory({ type: "import", description: "Imported SAMT package", metadata: { restorePoint: true } }); touch(); return result; }); },
    restoreLastImport() { return repository.transaction(() => { const state = repository.getState(); const point = state.meta?.restorePoints?.at(-1); if (!point?.state) throw new ValidationError("No import restore point is available."); repository.replaceState(clone(point.state), { persist: false }); addHistory({ type: "restore", description: "Restored the state before the last import", metadata: { restorePoint: true } }); touch(); return clone(repository.getState()); }); }
  };
}
