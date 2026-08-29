import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { clone, normalizedKey } from "../shared/validation.js";
import { createAction, validateAction, versionResultFields, isActionCompletionAchieved } from "../domain/actions.js";
import { createCategory, createTag, validateTaxonomy } from "../domain/taxonomy.js";
import { createUnit, validateUnits } from "../domain/units.js";
import { createResultField, validateResultFields } from "../domain/results.js";
import { createActionLog } from "../domain/logs.js";
import { createBlock, setDefinitionStatus, isRunCapableBlockType } from "../domain/blocks.js";
import { createRelationship, validateBlockGraph } from "../domain/relationships.js";
import { createOccurrence } from "../domain/occurrences.js";
import { resolveOccurrenceStatus } from "../domain/occurrences.js";
import { createRun, startRun as startDomainRun, finishRun as finishDomainRun, pauseRun as pauseDomainRun, resumeRun as resumeDomainRun, cancelRun as cancelDomainRun, appendRunTransition } from "../domain/runs.js";
import { returnToWorkflowStep as returnToDomainWorkflowStep, transitionWorkflowStep } from "../domain/workflows.js";
import { initializeRoutineRuntime, updateRoutineChild, evaluateRoutineRun } from "../domain/routines.js";
import { initializeProjectRuntime, updateProjectChild, evaluateProjectRun, createMilestone, updateMilestone, applyProjectScopeChange as applyDomainProjectScopeChange } from "../domain/projects.js";
import { evaluateWorkflowRun, initializeWorkflowRuntime } from "../domain/workflows.js";
import { createActivation, pauseActivation as pauseDomainActivation, resumeActivation as resumeDomainActivation, recordActivationRun } from "../domain/activations.js";
import { calculateTargetProgress } from "../domain/targets.js";
import { advanceCyclePosition, createBigCycleRuntime, generateNextSmallCycle, currentGeneratedCycleSlot, advanceGeneratedCycleSlot, resolveCycleSlot as resolveDomainCycleSlot, recordCycleResolution } from "../domain/cycles.js";
import { appendHistory } from "../domain/history.js";
import { domainEvent, EVENT_TYPES } from "./events.js";
import { importPackage } from "../import-export/importer.js";
import { packageCounts } from "../import-export/exporter.js";
import { validatePackage } from "../import-export/validator.js";
import { createEmptyState } from "./normalization.js";
import { appendRestorePoint, archiveDefinitionsInState, unarchiveDefinitionsInState, moveDefinitionsToBinInState, permanentlyDeleteDefinitionsInState, restoreDefinitionsInState, clearDataInState, getRuntimeDeletionImpact, permanentlyDeleteRuntimeRecordsInState } from "./data-management.js";

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
  function validateCurrentState(state) {
    const checked = validatePackage(state);
    if (!checked.ok) throw checked.error;
    return state;
  }
  function validateTimezone(value) {
    const timezone = String(value || "").trim();
    if (!timezone) throw new ValidationError("Timezone is required.");
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { throw new ValidationError(`Timezone is not recognised: ${timezone}`); }
    return timezone;
  }
  function normalizeSettingsPatch(state, patch = {}) {
    const next = clone(patch) || {};
    if (Object.prototype.hasOwnProperty.call(next, "timezone")) next.timezone = validateTimezone(next.timezone);
    if (Object.prototype.hasOwnProperty.call(next, "weekStartsOn")) { next.weekStartsOn = Number(next.weekStartsOn); if (!Number.isInteger(next.weekStartsOn) || next.weekStartsOn < 0 || next.weekStartsOn > 6) throw new ValidationError("Week start must be a day from Sunday through Saturday."); }
    if (next.capacity) {
      const capacity = { availableMinutes: 0, periodDays: 7, ...(state.settings?.capacity || {}), ...next.capacity };
      const availableMinutes = Number(capacity.availableMinutes); const periodDays = Number(capacity.periodDays);
      if (!Number.isFinite(availableMinutes) || availableMinutes < 0 || !Number.isFinite(periodDays) || periodDays < 1 || periodDays > 365) throw new ValidationError("Capacity must be non-negative and its planning window must be 1–365 days.");
      next.capacity = { ...capacity, availableMinutes, periodDays: Math.round(periodDays), updatedAt: now().toISOString() };
    }
    if (next.defaults) {
      for (const key of ["targetAutoClose", "cycleAutoClose", "routineExpire", "actionListExpire"]) if (key in next.defaults) next.defaults[key] = Boolean(next.defaults[key]);
      if (next.defaults.cyclePositionPolicy && !["continue", "restart"].includes(next.defaults.cyclePositionPolicy)) throw new ValidationError("Cycle position policy is invalid.");
      if (next.defaults.cycleMissedItemPolicy && !["keep_position", "advance_to_next", "restart_small_cycle", "restart_big_cycle"].includes(next.defaults.cycleMissedItemPolicy)) throw new ValidationError("Cycle unfinished-item policy is invalid.");
    }
    if (next.appearanceMode && !["light", "dark", "system"].includes(next.appearanceMode)) throw new ValidationError("Appearance mode is invalid.");
    return next;
  }
  function appendManagementHistory(state, description, objectType = "settings", objectId = null, metadata = {}) {
    addHistory({ type: "management", description, objectType, objectId, metadata: { management: true, ...metadata } });
  }
  function importRecord(value, result, state) {
    const summary = result?.summary || {};
    state.importHistory = [...(state.importHistory || []), {
      id: makeId("import"), importedAt: now().toISOString(), packageType: value?.packageType || summary.packageType || "backup", packageId: value?.packageId || summary.packageId || null,
      packageName: value?.packageName || summary.packageName || value?.packageId || "SAMT package", counts: packageCounts(value), success: true, restorePointCreated: true
    }].slice(-100);
  }

  function runSnapshot(block, inputSnapshot = null) {
    const snapshot = clone(inputSnapshot || {});
    snapshot.block = snapshot.block || clone(block);
    snapshot.relationships = snapshot.relationships || clone(block.relationships || []);
    snapshot.config = snapshot.config || clone(block.config || {});
    return snapshot;
  }

  function initializeRuntimeForBlock(block, snapshot, stamp) {
    const source = { ...clone(block), ...(clone(snapshot.block) || {}), relationships: clone(snapshot.relationships || block.relationships || []) };
    if (block.type === "routine") return initializeRoutineRuntime({ routine: source, now: stamp });
    if (block.type === "workflow") return initializeWorkflowRuntime({ workflow: source, now: stamp });
    if (block.type === "project") return initializeProjectRuntime({ project: source, now: stamp });
    if (block.type === "cycle") return { type: "cycle", currentSmallCycleId: null, currentSlot: -1, smallCycleNumber: 0, appearanceCoverage: [], completionCoverage: [], startedAt: new Date(stamp).toISOString() };
    return null;
  }

  function createStartedRun(state, block, input = {}) {
    const stamp = now();
    const snapshot = runSnapshot(block, input.snapshot);
    const runtime = input.runtime || initializeRuntimeForBlock(block, snapshot, stamp);
    const run = createRun({
      ...input,
      id: input.id || makeId("run"),
      blockId: block.id,
      activationId: input.activationId || null,
      label: input.label || block.name,
      snapshot,
      runtime,
      children: input.children || runtime?.children || [],
      steps: input.steps || runtime?.steps || null,
      currentStepId: input.currentStepId || runtime?.currentStepId || null,
      plannedStart: input.plannedStart || input.scheduledAt || null,
      deadline: input.deadline ?? block.config?.deadline ?? null,
      activationSnapshot: input.activationSnapshot || null,
      now: stamp
    });
    return startDomainRun(run, stamp);
  }

  function evaluateRun(run, block, finished = false, state = repository.getState()) {
    const source = run.snapshot?.block || block;
    if (block.type === "routine") return evaluateRoutineRun({ run, routine: source, now: now(), finished });
    if (block.type === "workflow") return evaluateWorkflowRun({ run, workflow: source, now: now(), finished });
    if (block.type === "project") {
      const resultFields = Object.fromEntries((state.actions || []).flatMap((action) => (action.resultFields || []).map((field) => [field.id, field])));
      const results = {};
      for (const log of (state.actionLogs || []).filter((candidate) => candidate.contextRefs?.some((reference) => reference.runId === run.id)).sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt))) {
        for (const entry of log.resultValues || []) results[entry.fieldId] = entry.value;
      }
      const targets = Object.fromEntries((state.blocks || []).filter((candidate) => candidate.type === "target").map((target) => {
        try {
          const progress = calculateTargetProgress({ target, logs: state.actionLogs || [], actions: state.actions || [], blocks: state.blocks || [], units: state.units || [], descendantBlockIds: target.config?.descendantBlockIds || [] });
          return [target.id, { ...progress, reached: Boolean(progress.reached || progress.status === "reached" || progress.status === "REACHED") }];
        } catch {
          return [target.id, { reached: false }];
        }
      }));
      return evaluateProjectRun({ project: source, run, now: now(), finished, results, resultFields, targets, units: state.units || [] });
    }
    return { status: run.status, qualified: true, satisfied: true };
  }

  function applyRunEvaluation(run, evaluation, { finished = false } = {}) {
    const stamp = now();
    let next = { ...run, updatedAt: stamp.toISOString() };
    if (evaluation.children) {
      next.children = clone(evaluation.children);
      next.runtime = { ...(next.runtime || {}), type: next.runtime?.type || "routine", children: clone(evaluation.children), progress: clone(evaluation.progress), evaluation: clone(evaluation), updatedAt: stamp.toISOString() };
    }
    if (evaluation.steps) {
      next.steps = clone(evaluation.steps);
      next.currentStepId = evaluation.currentStepId || null;
      next.runtime = { ...(next.runtime || {}), type: next.runtime?.type || "workflow", steps: clone(evaluation.steps), currentStepId: next.currentStepId, evaluation: clone(evaluation), updatedAt: stamp.toISOString() };
    }
    if (evaluation.results) next.runtime = { ...(next.runtime || {}), conditions: clone(evaluation.results), evaluation: clone(evaluation), updatedAt: stamp.toISOString() };
    if (evaluation.progress) next.runtime = { ...(next.runtime || {}), progress: clone(evaluation.progress), evaluation: clone(evaluation), updatedAt: stamp.toISOString() };
    if (finished) {
      const qualified = evaluation.qualified ?? evaluation.satisfied ?? true;
      if (!qualified) throw new ValidationError("Run requirements are not satisfied.");
      return finishDomainRun(next, "COMPLETED", stamp);
    }
    if (evaluation.status && !["NOT_STARTED", "PAUSED"].includes(run.status)) {
      if (["COMPLETED", "PARTIAL", "MISSED", "EXPIRED"].includes(evaluation.status)) return finishDomainRun(next, evaluation.status, stamp);
      next.status = evaluation.status;
    }
    return next;
  }

  function runRelationships(run, block) {
    return run.snapshot?.relationships || run.snapshot?.block?.relationships || block.relationships || [];
  }

  function actionChildForRun(run, block, actionId, relationshipId = null) {
    const relationships = runRelationships(run, block);
    if (relationshipId) return relationships.find((relationship) => relationship.id === relationshipId && relationship.kind === "action" && relationship.refId === actionId) || null;
    const matches = relationships.filter((relationship) => relationship.kind === "action" && relationship.refId === actionId);
    return matches.length === 1 ? matches[0] : null;
  }

  function aggregatedRunLog(state, run, relationshipId, action) {
    const logs = (state.actionLogs || []).filter((log) => log.contextRefs?.some((reference) =>
      reference.runId === run.id && (!relationshipId || reference.relationshipId === relationshipId)
    ));
    return {
      quantity: logs.reduce((sum, log) => sum + Number(log.quantity || 0), 0),
      durationMinutes: logs.reduce((sum, log) => sum + Number(log.durationMinutes || 0), 0),
      logs
    };
  }

  function updateRunAfterActionLog(state, run, block, action, input, log) {
    const relationship = actionChildForRun(run, block, action.id, input.relationshipId);
    if (!relationship) return;
    const aggregate = aggregatedRunLog(state, run, relationship.id, action);
    let next = run;
    if (block.type === "routine" || block.type === "project") {
      if (isActionCompletionAchieved({ action, log: aggregate })) {
        next = block.type === "routine"
          ? updateRoutineChild({ run, relationshipId: relationship.id, state: "COMPLETED", logId: log.id, now: now() })
          : updateProjectChild({ run, relationshipId: relationship.id, state: "COMPLETED", logId: log.id, now: now() });
      } else {
        const children = (run.children || []).map((child) => child.relationshipId === relationship.id ? { ...child, logIds: [...new Set([...(child.logIds || []), ...aggregate.logs.map((item) => item.id)])], state: child.state === "AVAILABLE" ? "IN_PROGRESS" : child.state, updatedAt: now().toISOString() } : child);
        next = { ...run, children, runtime: { ...(run.runtime || {}), children: clone(children) }, updatedAt: now().toISOString() };
      }
    } else if (block.type === "workflow" && input.completeStep === true) {
      next = transitionWorkflowStep({ run, stepId: relationship.id, state: "COMPLETED", reason: null, now: now() });
    }
    const evaluation = evaluateRun(next, block, false);
    return applyRunEvaluation(next, evaluation, { finished: false });
  }

  function ensureCycleRuntime(state, cycle) {
    let bigIndex = (state.cycleBigCycles || []).findIndex((item) => item.cycleId === cycle.id && item.status === "open");
    if (bigIndex < 0) {
      const big = createBigCycleRuntime({
        cycleId: cycle.id,
        relationships: cycle.relationships || [],
        smallCycleSize: cycle.config?.smallCycleSize || null,
        fairness: cycle.config?.fairness || {},
        generationMode: cycle.config?.generationMode,
        config: cycle.config,
        now: now()
      });
      state.cycleBigCycles.push(big);
      bigIndex = state.cycleBigCycles.length - 1;
    }
    const big = state.cycleBigCycles[bigIndex];
    let small = (state.cycleSmallCycles || []).find((item) => item.id === big.currentSmallCycleId);
    if (!small || Number(big.currentSlot) >= Number(small.size || small.slots?.length || 0)) {
      small = generateNextSmallCycle({ bigCycle: big, relationships: cycle.relationships || [], now: now() });
      state.cycleSmallCycles.push(small);
      big.smallCycles = [...(big.smallCycles || []), clone(small)];
      big.currentSmallCycleId = small.id;
      big.currentSlot = -1;
      big.fairness = clone(small.fairness);
    }
    return { big, bigIndex, small };
  }


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
        const state = repository.getState();
        const { index, item: parent } = requireStateItem(state.blocks, parentBlockId, "Block");
        const before = (parent.relationships || []).find((relationship) => relationship.id === relationshipId);
        if (!before) throw new NotFoundError(`Relationship not found: ${relationshipId}`);
        const nextRelationship = {
          ...before,
          ...clone(patch),
          id: relationshipId,
          parentBlockId,
          kind: patch.kind || before.kind,
          refId: patch.refId || before.refId,
          config: { ...(before.config || {}), ...(clone(patch.config) || {}) },
          updatedAt: now().toISOString()
        };
        const next = {
          ...parent,
          relationships: parent.relationships.map((relationship) => relationship.id === relationshipId ? nextRelationship : relationship),
          updatedAt: now().toISOString()
        };
        validateBlockGraph({ blocks: state.blocks.map((block, current) => current === index ? next : block), actions: state.actions });
        replaceAt(state.blocks, index, next);
        touch();
        addHistory({ type: "definition", description: `Updated relationship in ${parent.name}`, objectType: "relationship", objectId: relationshipId, snapshots: { before: clone(before), after: clone(nextRelationship) } });
        return clone(nextRelationship);
      });
    },
    removeRelationship(parentBlockId, relationshipId) { return repository.transaction(() => { const state = repository.getState(); const { index, item: parent } = requireStateItem(state.blocks, parentBlockId, "Block"); const removed = (parent.relationships || []).find((relationship) => relationship.id === relationshipId); if (!removed) throw new NotFoundError(`Relationship not found: ${relationshipId}`); replaceAt(state.blocks, index, { ...parent, relationships: parent.relationships.filter((relationship) => relationship.id !== relationshipId), updatedAt: now().toISOString() }); touch(); addHistory({ type: "definition", description: `Removed relationship from ${parent.name}`, objectType: "relationship", objectId: relationshipId, snapshots: { removed: clone(removed) } }); return clone(removed); }); },
    logAction(input = {}) {
      return repository.transaction(() => {
        if (commandWasApplied(input.commandId)) return clone(repository.getState().actionLogs.find((log) => log.commandId === input.commandId));
        const state = repository.getState();
        const action = state.actions.find((candidate) => candidate.id === input.actionId);
        if (!action) throw new NotFoundError(`Action not found: ${input.actionId}`);
        let run = input.runId ? state.runs.find((candidate) => candidate.id === input.runId) : null;
        if (input.runId && !run) throw new NotFoundError(`Run not found: ${input.runId}`);
        const contextRefs = clone(input.contextRefs || []);
        if (run) {
          const context = { blockId: run.blockId, runId: run.id, relationshipId: input.relationshipId || null, occurrenceId: input.occurrenceId || null };
          const existingRunReference = contextRefs.find((reference) => reference.runId === run.id && !reference.occurrenceId);
          if (existingRunReference) {
            Object.assign(existingRunReference, context);
          } else {
            contextRefs.push(context);
          }
        }
        const log = createActionLog({ ...input, contextRefs, action, finalizing: Boolean(input.finalizing), now: now(), units: state.units });
        if (state.actionLogs.some((candidate) => candidate.id === log.id)) throw new ConflictError(`Action Log ID already exists: ${log.id}`);
        for (const reference of log.contextRefs || []) {
          if (!reference.occurrenceId) continue;
          const occurrence = state.occurrences.find((item) => item.id === reference.occurrenceId);
          if (!occurrence) throw new NotFoundError(`Occurrence not found: ${reference.occurrenceId}`);
          const relationship = state.blocks.flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId);
          if (relationship?.kind === "action" && relationship.refId !== action.id) throw new ValidationError("Action Log cannot be attributed to an Occurrence for a different Action.");
        }
        if (input.commandId) log.commandId = input.commandId;
        state.actionLogs.push(log);
        for (const reference of log.contextRefs || []) {
          const occurrence = state.occurrences.find((item) => item.id === reference.occurrenceId);
          if (!occurrence) continue;
          if (!occurrence.logIds.includes(log.id)) occurrence.logIds.push(log.id);
          const beforeStatus = occurrence.status;
          const nextStatus = resolveOccurrenceStatus({ occurrence, logs: state.actionLogs, action, now: now(), unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy || "expire" });
          if (nextStatus !== beforeStatus) {
            occurrence.status = nextStatus;
            occurrence.updatedAt = now().toISOString();
            emit(nextStatus === "completed" ? EVENT_TYPES.OCCURRENCE_COMPLETED : EVENT_TYPES.OCCURRENCE_STATUS_CHANGED, { occurrenceId: occurrence.id, status: nextStatus });
          }
        }
        if (run) {
          const block = state.blocks.find((candidate) => candidate.id === run.blockId);
          if (block) {
            const runIndex = state.runs.findIndex((candidate) => candidate.id === run.id);
            if (runIndex >= 0) state.runs[runIndex] = updateRunAfterActionLog(state, run, block, action, input, log);
          }
        }
        touch();
        addHistory({ type: "action_log", description: `Logged ${action.name}`, objectType: "actionLog", objectId: log.id, actionId: action.id, snapshots: { action: log.actionSnapshot, results: log.resultValues.map((entry) => entry.snapshot) } });
        emit(EVENT_TYPES.ACTION_LOGGED, { actionLogId: log.id, actionId: action.id, runId: input.runId || null });
        return clone(log);
      });
    },
    deleteActionLog(id) { return repository.transaction(() => { const state = repository.getState(); const { index, item: removed } = requireStateItem(state.actionLogs, id, "Action Log"); state.actionLogs.splice(index, 1); for (const occurrence of state.occurrences || []) occurrence.logIds = (occurrence.logIds || []).filter((logId) => logId !== id); touch(); addHistory({ type: "action_log", description: `Deleted Action Log: ${removed.actionSnapshot?.name || removed.actionId}`, objectType: "actionLog", objectId: id, metadata: { factualSnapshotPreserved: true }, snapshots: { deleted: removed } }); emit(EVENT_TYPES.ACTION_LOG_DELETED, { actionLogId: id }); return clone(removed); }); },
    createActivation(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState();
        const block = state.blocks.find((candidate) => candidate.id === input.blockId);
        if (!block) throw new NotFoundError(`Block not found: ${input.blockId}`);
        if (!input.allowMultiple && state.activations.some((activation) => activation.blockId === block.id && activation.status === "active")) {
          throw new ConflictError("An active Activation already exists for this Block.");
        }
        const activation = createActivation({ ...input, id: input.id || makeId("activation"), now: now() });
        state.activations.push(activation);
        if (activation.mode === "run_now" && isRunCapableBlockType(block.type)) {
          const run = createStartedRun(state, block, { activationId: activation.id, label: activation.label || block.name, scheduledAt: now().toISOString(), activationSnapshot: activation });
          state.runs.push(run);
          state.activations[state.activations.length - 1] = recordActivationRun(activation, now());
        }
        touch();
        addHistory({ type: "activation", description: `Created activation for ${block.name}`, objectType: "activation", objectId: activation.id });
        emit(EVENT_TYPES.BLOCK_ACTIVATED, { activationId: activation.id, blockId: activation.blockId });
        return clone(state.activations[state.activations.length - 1]);
      });
    },
    pauseActivation(id, options = {}) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.activations, id, "Activation"); state.activations[index] = pauseDomainActivation(state.activations[index], { ...options, now: now() }); touch(); addHistory({ type: "activation", description: "Paused activation", objectType: "activation", objectId: id }); emit(EVENT_TYPES.BLOCK_PAUSED, { activationId: id }); return clone(state.activations[index]); }); },
    resumeActivation(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.activations, id, "Activation"); state.activations[index] = resumeDomainActivation(state.activations[index], now()); touch(); addHistory({ type: "activation", description: "Resumed activation", objectType: "activation", objectId: id }); emit(EVENT_TYPES.BLOCK_ACTIVATED, { activationId: id, blockId: state.activations[index].blockId }); return clone(state.activations[index]); }); },
    startRun(input = {}) {
      return repository.transaction(() => {
        const state = repository.getState();
        const block = state.blocks.find((candidate) => candidate.id === input.blockId);
        if (!block) throw new NotFoundError(`Block not found: ${input.blockId}`);
        if (!isRunCapableBlockType(block.type)) throw new ValidationError(`${block.type} Blocks do not create Runs.`);
        if (["ARCHIVED", "PAUSED"].includes(block.definitionStatus)) throw new ValidationError("This Block is not active.");
        const run = createStartedRun(state, block, input);
        state.runs.push(run);
        touch();
        addHistory({ type: "run", description: `Started ${block.name}`, objectType: "run", objectId: run.id, snapshots: { run: run.snapshot } });
        emit(EVENT_TYPES.RUN_STARTED, { runId: run.id, blockId: block.id });
        return clone(run);
      });
    },
    finishRun(id, status = "COMPLETED") {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, id, "Run");
        if (status === "COMPLETED") {
          const block = state.blocks.find((candidate) => candidate.id === run.blockId);
          const evaluated = block ? evaluateRun(run, block, true) : { qualified: true, satisfied: true, status: run.status };
          state.runs[index] = block ? applyRunEvaluation(run, evaluated, { finished: true }) : finishDomainRun(run, status, now());
        } else {
          state.runs[index] = finishDomainRun(run, status, now());
        }
        touch();
        addHistory({ type: "run", description: `Finished Run (${status})`, objectType: "run", objectId: id });
        emit(EVENT_TYPES.RUN_FINISHED, { runId: id, status: state.runs[index].status });
        return clone(state.runs[index]);
      });
    },
    pauseRun(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.runs, id, "Run"); state.runs[index] = pauseDomainRun(state.runs[index], now()); touch(); addHistory({ type: "run", description: "Paused Run", objectType: "run", objectId: id }); emit(EVENT_TYPES.RUN_PAUSED, { runId: id }); return clone(state.runs[index]); }); },
    resumeRun(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.runs, id, "Run"); state.runs[index] = resumeDomainRun(state.runs[index], now()); touch(); addHistory({ type: "run", description: "Resumed Run", objectType: "run", objectId: id }); emit(EVENT_TYPES.RUN_RESUMED, { runId: id }); return clone(state.runs[index]); }); },
    returnToWorkflowStep(runId, stepId) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const steps = Array.isArray(run.steps) ? run.steps : Array.isArray(run.snapshot?.steps) ? run.snapshot.steps : null;
        if (!steps) throw new ValidationError("This Workflow Run has no runtime steps.");
        const reopened = returnToDomainWorkflowStep({ steps, stepId, now: now() });
        const transitioned = appendRunTransition({ ...run, steps: reopened, currentStepId: stepId }, { type: "RETURN_TO_STEP", stepId, downstreamReopened: true }, now());
        state.runs[index] = { ...transitioned, runtime: { ...(transitioned.runtime || {}), type: "workflow", steps: clone(reopened), currentStepId: stepId } };
        touch();
        addHistory({ type: "workflow", description: `Returned Workflow Run to step ${stepId}`, objectType: "run", objectId: runId, metadata: { stepId, downstreamReopened: true } });
        emit(EVENT_TYPES.DEFINITION_CHANGED, { runId, workflowStepId: stepId, transition: "RETURN_TO_STEP" });
        return clone(state.runs[index]);
      });
    },
    updateRoutineChild(runId, relationshipId, stateName, reason = null) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const block = state.blocks.find((candidate) => candidate.id === run.blockId);
        if (!block || block.type !== "routine") throw new ValidationError("Run is not a Routine Run.");
        const next = updateRoutineChild({ run, relationshipId, state: stateName, reason, now: now() });
        state.runs[index] = applyRunEvaluation(next, evaluateRun(next, block, false));
        touch();
        addHistory({ type: "routine", description: `Routine child ${stateName}`, objectType: "run", objectId: runId, metadata: { relationshipId, state: stateName, reason } });
        return clone(state.runs[index]);
      });
    },
    updateWorkflowStep(runId, stepId, stateName, reason = null) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const block = state.blocks.find((candidate) => candidate.id === run.blockId);
        if (!block || block.type !== "workflow") throw new ValidationError("Run is not a Workflow Run.");
        const next = transitionWorkflowStep({ run, stepId, state: stateName, reason, now: now() });
        const evaluated = evaluateRun(next, block, false);
        state.runs[index] = applyRunEvaluation(next, evaluated);
        touch();
        addHistory({ type: "workflow", description: `Workflow step ${stateName}`, objectType: "run", objectId: runId, metadata: { stepId, state: stateName, reason } });
        return clone(state.runs[index]);
      });
    },
    startWorkflowStep(runId, stepId) { return this.updateWorkflowStep(runId, stepId, "IN_PROGRESS"); },
    completeWorkflowStep(runId, stepId) { return this.updateWorkflowStep(runId, stepId, "COMPLETED"); },
    skipWorkflowStep(runId, stepId, reason = "") { return this.updateWorkflowStep(runId, stepId, "SKIPPED", reason); },
    excuseWorkflowStep(runId, stepId, reason = "") { return this.updateWorkflowStep(runId, stepId, "EXCUSED", reason); },
    markWorkflowStepNotApplicable(runId, stepId, reason = "") { return this.updateWorkflowStep(runId, stepId, "NOT_APPLICABLE", reason); },
    blockWorkflowStep(runId, stepId, reason = "") { return this.updateWorkflowStep(runId, stepId, "BLOCKED", reason); },
    unblockWorkflowStep(runId, stepId) { return this.updateWorkflowStep(runId, stepId, "AVAILABLE"); },
    cancelRun(id) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index } = requireStateItem(state.runs, id, "Run");
        state.runs[index] = cancelDomainRun(state.runs[index], now());
        touch();
        addHistory({ type: "run", description: "Cancelled Run", objectType: "run", objectId: id });
        emit(EVENT_TYPES.RUN_FINISHED, { runId: id, status: "CANCELLED" });
        return clone(state.runs[index]);
      });
    },
    updateProjectChild(runId, relationshipId, stateName, reason = null) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const block = state.blocks.find((candidate) => candidate.id === run.blockId);
        if (!block || block.type !== "project") throw new ValidationError("Run is not a Project Run.");
        const next = updateProjectChild({ run, relationshipId, state: stateName, reason, now: now() });
        state.runs[index] = applyRunEvaluation(next, evaluateRun(next, block, false));
        touch();
        addHistory({ type: "project", description: `Project child ${stateName}`, objectType: "run", objectId: runId, metadata: { relationshipId, state: stateName, reason } });
        return clone(state.runs[index]);
      });
    },
    addProjectMilestone(runId, input = {}) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const block = state.blocks.find((candidate) => candidate.id === run.blockId);
        if (!block || block.type !== "project") throw new ValidationError("Run is not a Project Run.");
        const milestone = createMilestone({ ...input, id: input.id || makeId("milestone"), now: now() });
        const milestones = [...(run.runtime?.milestones || []), milestone];
        state.runs[index] = { ...run, runtime: { ...(run.runtime || {}), milestones, updatedAt: now().toISOString() }, updatedAt: now().toISOString() };
        touch();
        addHistory({ type: "project", description: `Added milestone: ${milestone.name}`, objectType: "milestone", objectId: milestone.id, metadata: { runId } });
        return clone(milestone);
      });
    },
    updateProjectMilestone(runId, milestoneId, patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        state.runs[index] = updateMilestone({ run, milestoneId, patch, now: now() });
        touch();
        return clone(state.runs[index].runtime.milestones.find((milestone) => milestone.id === milestoneId));
      });
    },
    completeProjectMilestone(runId, milestoneId) { return this.updateProjectMilestone(runId, milestoneId, { status: "completed" }); },
    cancelProjectMilestone(runId, milestoneId) { return this.updateProjectMilestone(runId, milestoneId, { status: "cancelled" }); },
    applyProjectScopeChange(runId, changes = []) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: run } = requireStateItem(state.runs, runId, "Run");
        const block = state.blocks.find((candidate) => candidate.id === run.blockId);
        if (!block || block.type !== "project") throw new ValidationError("Run is not a Project Run.");
        const next = applyDomainProjectScopeChange({ run, project: block, changes, now: now() });
        state.runs[index] = next;
        state.scopeChangeEvents = [...(state.scopeChangeEvents || []), { id: makeId("scope_change"), blockId: block.id, runId, changedAt: now().toISOString(), changes: clone(changes) }];
        touch();
        addHistory({ type: "project", description: "Applied Project scope change to active Run", objectType: "run", objectId: runId, metadata: { changes: clone(changes) } });
        return clone(next);
      });
    },
    createOccurrence(input = {}) { return repository.transaction(() => { const state = repository.getState(); const occurrence = createOccurrence({ ...input, id: input.id || makeId("occurrence"), now: now() }); const duplicate = state.occurrences.find((item) => item.id === occurrence.id || occurrence.scheduledAt != null && item.relationshipId === occurrence.relationshipId && item.scheduledAt === occurrence.scheduledAt); if (duplicate) return clone(duplicate); state.occurrences.push(occurrence); touch(); emit(EVENT_TYPES.OCCURRENCE_CREATED, { occurrenceId: occurrence.id }); return clone(occurrence); }); },
    completeOccurrence(id) { return this.resolveOccurrence(id, "completed"); },
    skipOccurrence(id, reason = "") { return this.resolveOccurrence(id, "skipped", reason); },
    resolveOccurrence(id, status, reason = "") { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.occurrences, id, "Occurrence"); const occurrence = state.occurrences[index]; if (!TERMINAL_OCCURRENCES.includes(status)) throw new ValidationError("Occurrence status is invalid."); const relationship = state.blocks.flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId); if (status === "skipped" && relationship?.config?.allowSkip !== true) throw new ValidationError("Skipping this occurrence is not allowed for this relationship."); if (status === "skipped" && relationship?.config?.requireSkipReason && !String(reason || "").trim()) throw new ValidationError("A skip reason is required."); state.occurrences[index] = { ...occurrence, status, reason: reason || null, updatedAt: now().toISOString() }; touch(); addHistory({ type: "occurrence", description: `${status} occurrence`, objectType: "occurrence", objectId: id, metadata: { reason } }); emit(status === "completed" ? EVENT_TYPES.OCCURRENCE_COMPLETED : status === "missed" ? EVENT_TYPES.OCCURRENCE_MISSED : EVENT_TYPES.OCCURRENCE_STATUS_CHANGED, { occurrenceId: id, status }); return clone(state.occurrences[index]); }); },
    advanceCycle(id, steps = 1) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: cycle } = requireStateItem(state.blocks, id, "Cycle");
        if (cycle.type !== "cycle") throw new ValidationError("Block is not a Cycle.");
        const runtime = ensureCycleRuntime(state, cycle);
        const moved = advanceGeneratedCycleSlot(runtime.big, runtime.small, { steps, now: now() });
        Object.assign(runtime.big, moved);
        state.cycleBigCycles[runtime.bigIndex] = runtime.big;
        state.blocks[index] = { ...cycle, config: { ...(cycle.config || {}), currentSmallCycleId: runtime.small.id, currentSlot: runtime.big.currentSlot }, updatedAt: now().toISOString() };
        touch();
        addHistory({ type: "cycle", description: `Advanced Cycle: ${cycle.name}`, objectType: "cycle", objectId: id, snapshots: { smallCycleId: runtime.small.id, slot: runtime.big.currentSlot } });
        emit(EVENT_TYPES.CYCLE_ADVANCED, { cycleId: id, smallCycleId: runtime.small.id, slot: runtime.big.currentSlot });
        return clone(state.blocks[index]);
      });
    },
    resolveCycleSlot(id, { outcome = "completed", reason = null } = {}) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: cycle } = requireStateItem(state.blocks, id, "Cycle");
        if (cycle.type !== "cycle") throw new ValidationError("Block is not a Cycle.");
        const runtime = ensureCycleRuntime(state, cycle);
        const slot = currentGeneratedCycleSlot(runtime.big, runtime.small);
        if (!slot) throw new ValidationError("This Cycle has no generated slot to resolve.");
        const relationship = (cycle.relationships || []).find((candidate) => candidate.id === slot.relationshipId);
        if (outcome === "skipped" && relationship?.config?.allowSkip !== true) throw new ValidationError("Skipping this Cycle relationship is not allowed.");
        if (outcome === "skipped" && relationship?.config?.requireSkipReason && !String(reason || "").trim()) throw new ValidationError("A skip reason is required.");
        const slotIndex = Math.max(0, Number(runtime.big.currentSlot ?? 0));
        const resolved = resolveDomainCycleSlot({ slot, outcome, allowSkip: relationship?.config?.allowSkip === true, reason, now: now() });
        let updatedBig = recordCycleResolution({
          bigCycle: runtime.big,
          smallCycle: runtime.small,
          relationshipId: resolved.relationshipId,
          slot: slotIndex,
          outcome: resolved.outcome,
          now: now()
        });
        if (!["deferred", "unavailable"].includes(outcome)) updatedBig = advanceGeneratedCycleSlot(updatedBig, runtime.small, { steps: 1, now: now() });
        state.cycleBigCycles[runtime.bigIndex] = updatedBig;
        state.blocks[index] = { ...cycle, config: { ...(cycle.config || {}), currentSmallCycleId: runtime.small.id, currentSlot: updatedBig.currentSlot }, updatedAt: now().toISOString() };
        touch();
        addHistory({ type: "cycle", description: `Resolved Cycle slot: ${outcome}`, objectType: "cycle_resolution", objectId: resolved.relationshipId, metadata: { cycleId: id, smallCycleId: runtime.small.id, slot: slotIndex, outcome, reason: reason || null } });
        emit(EVENT_TYPES.CYCLE_ADVANCED, { cycleId: id, smallCycleId: runtime.small.id, slot: updatedBig.currentSlot, outcome });
        return clone({ cycle: state.blocks[index], bigCycle: updatedBig, smallCycle: runtime.small, resolution: resolved });
      });
    },
    generateCycleSmallCycle(id) {
      return repository.transaction(() => {
        const state = repository.getState();
        const { index, item: cycle } = requireStateItem(state.blocks, id, "Cycle");
        if (cycle.type !== "cycle") throw new ValidationError("Block is not a Cycle.");
        const runtime = ensureCycleRuntime(state, cycle);
        const small = runtime.small;
        state.blocks[index] = { ...cycle, config: { ...(cycle.config || {}), currentSmallCycleId: small.id, currentSlot: runtime.big.currentSlot }, updatedAt: now().toISOString() };
        touch();
        addHistory({ type: "cycle", description: `Generated Small Cycle: ${cycle.name}`, objectType: "cycleSmallCycle", objectId: small.id, snapshots: { sequence: small.slots, generationMode: small.generationMode } });
        return clone(small);
      });
    },
    closePeriod(id, evaluation) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.periods, id, "Period"); const period = state.periods[index]; if (period.status === "closed") return clone(period); const closed = { ...period, status: "closed", closedAt: now().toISOString(), evaluation: clone(evaluation) }; state.periods[index] = closed; if (!state.targetEvaluations.some((item) => item.periodId === id)) state.targetEvaluations.push({ id: `${id}:evaluation`, periodId: id, ownerId: period.ownerId, evaluation: clone(evaluation), closedAt: closed.closedAt, snapshot: clone(period.snapshot) }); touch(); addHistory({ type: "period", description: "Closed evaluation period", objectType: "period", objectId: id, snapshots: { evaluation } }); emit(EVENT_TYPES.PERIOD_CLOSED, { periodId: id }); return clone(closed); }); },
    updateSettings(patch = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const nextPatch = normalizeSettingsPatch(state, patch);
        state.settings = { ...(state.settings || {}), ...nextPatch, defaults: { ...(state.settings?.defaults || {}), ...(nextPatch.defaults || {}) }, capacity: { ...(state.settings?.capacity || {}), ...(nextPatch.capacity || {}) } };
        touch(); addHistory({ type: "settings", description: "Updated Settings", objectType: "settings", snapshots: { patch: clone(nextPatch) } }); return clone(state.settings);
      });
    },
    archiveDefinitions(selections) {
      return repository.transaction(() => { const state = repository.getState(); const archived = archiveDefinitionsInState(state, selections, { now: now() }); validateCurrentState(state); touch(); appendManagementHistory(state, `Archived ${archived.length} definition${archived.length === 1 ? "" : "s"}.`, "definitions", null, { selections: clone(archived) }); return clone(archived); });
    },
    unarchiveDefinitions(selections) {
      return repository.transaction(() => { const state = repository.getState(); const restored = unarchiveDefinitionsInState(state, selections, { now: now() }); validateCurrentState(state); touch(); appendManagementHistory(state, `Unarchived ${restored.length} definition${restored.length === 1 ? "" : "s"}.`, "definitions", null, { selections: clone(restored) }); return clone(restored); });
    },
    moveDefinitionsToBin(selections, options = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const selected = clone(selections); const shouldPoint = options.createRestorePoint !== false;
        if (shouldPoint) appendRestorePoint(state, { id: makeId("restore_point"), reason: "Move definitions to Bin", now: now() });
        const moved = moveDefinitionsToBinInState(state, selected, { ...options, now: now() }); validateCurrentState(state); touch(); appendManagementHistory(state, `Moved ${moved.length} definition${moved.length === 1 ? "" : "s"} to the Bin.`, "bin", null, { selections: clone(moved) }); return clone(moved);
      });
    },
    permanentlyDeleteDefinitions(selections, options = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); appendRestorePoint(state, { id: makeId("restore_point"), reason: "Permanent delete", now: now() });
        const result = permanentlyDeleteDefinitionsInState(state, selections, { ...options, now: now() }); validateCurrentState(state); touch(); appendManagementHistory(state, `Permanently deleted ${result.deleted.length} definition${result.deleted.length === 1 ? "" : "s"}.`, "definitions", null, { selections: clone(result.deleted), tombstones: result.tombstones }); return clone(result);
      });
    },
    restoreDefinitions(selections, options = {}) {
      return repository.transaction(() => { const state = repository.getState(); const restored = restoreDefinitionsInState(state, selections, options); validateCurrentState(state); touch(); appendManagementHistory(state, `Restored ${restored.length} definition${restored.length === 1 ? "" : "s"} from the Bin.`, "bin", null, { selections: clone(restored) }); return clone(restored); });
    },
    previewRuntimeDeletion(selections = []) {
      const state = repository.getState();
      return clone(getRuntimeDeletionImpact(state, selections));
    },
    permanentlyDeleteRuntimeRecords(selections = [], options = {}) {
      return repository.transaction(() => {
        const state = repository.getState();
        const impact = getRuntimeDeletionImpact(state, selections);
        appendRestorePoint(state, { id: makeId("restore_point"), reason: "Permanent delete runtime records", now: now() });
        const result = permanentlyDeleteRuntimeRecordsInState(state, selections, { ...options, now: now() });
        validateCurrentState(state);
        touch();
        appendManagementHistory(state, `Permanently deleted ${result.deleted.length} runtime/data record${result.deleted.length === 1 ? "" : "s"}.`, "runtime", null, { impact: clone(impact) });
        return clone(result);
      });
    },
    deleteSelectedRuntimeRecords(selections = [], options = {}) {
      return this.permanentlyDeleteRuntimeRecords(selections, options);
    },
    clearData(options = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); appendRestorePoint(state, { id: makeId("restore_point"), reason: "Clear selected data", now: now() });
        const result = clearDataInState(state, { ...options, now: now() }); validateCurrentState(state); touch(); appendManagementHistory(state, "Cleared selected SAMT data.", "settings", null, { categories: clone(options.categories || []), result: clone(result) }); return clone(result);
      });
    },
    setPrimaryProject(id) { return this.updateSettings({ primaryProjectId: id || null }); },
    createTask(input = {}) { return repository.transaction(() => { const state = repository.getState(); const task = { id: input.id || makeId("task"), name: String(input.name || "").trim(), actionId: input.actionId || null, type: input.type || "one_time", targetDate: input.targetDate || null, status: input.status || "active", notes: String(input.notes || ""), createdAt: new Date(input.createdAt || now()).toISOString(), resolvedAt: null }; if (!task.name) throw new ValidationError("Task name is required."); state.tasks.push(task); touch(); addHistory({ type: "task", description: `Created Task: ${task.name}`, objectType: "task", objectId: task.id }); return clone(task); }); },
    completeTask(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.tasks, id, "Task"); state.tasks[index] = { ...state.tasks[index], status: "completed", resolvedAt: now().toISOString() }; touch(); addHistory({ type: "task", description: `Completed Task: ${state.tasks[index].name}`, objectType: "task", objectId: id }); return clone(state.tasks[index]); }); },
    updateTask(id, patch = {}) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.tasks, id, "Task"); state.tasks[index] = { ...state.tasks[index], ...clone(patch), id, updatedAt: now().toISOString() }; touch(); return clone(state.tasks[index]); }); },
    createQuickTask(input = {}) { return repository.transaction(() => { const state = repository.getState(); const task = { id: input.id || makeId("quick_task"), name: String(input.name || "").trim(), date: input.date || null, time: input.time || null, deadline: input.deadline || null, status: input.status || "active", createdAt: new Date(input.createdAt || now()).toISOString(), resolvedAt: null }; if (!task.name) throw new ValidationError("Quick task name is required."); state.quickTasks.push(task); touch(); addHistory({ type: "task", description: `Created Quick Task: ${task.name}`, objectType: "quickTask", objectId: task.id }); return clone(task); }); },
    completeQuickTask(id) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.quickTasks, id, "Quick Task"); state.quickTasks[index] = { ...state.quickTasks[index], status: "completed", resolvedAt: now().toISOString() }; touch(); return clone(state.quickTasks[index]); }); },
    createReview(input = {}) { return repository.transaction(() => { const state = repository.getState(); const review = { id: input.id || makeId("review"), name: String(input.name || "").trim(), date: input.date || now().toISOString().slice(0, 10), notes: String(input.notes || ""), status: input.status || "draft", createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), completedAt: null }; if (!review.name) throw new ValidationError("Review name is required."); state.reviews.push(review); touch(); addHistory({ type: "review", description: `Created Review: ${review.name}`, objectType: "review", objectId: review.id }); return clone(review); }); },
    updateReview(id, patch = {}) { return repository.transaction(() => { const state = repository.getState(); const { index } = requireStateItem(state.reviews, id, "Review"); state.reviews[index] = { ...state.reviews[index], ...clone(patch), id, updatedAt: now().toISOString() }; touch(); return clone(state.reviews[index]); }); },
    completeReview(id) { return this.updateReview(id, { status: "completed", completedAt: now().toISOString() }); },
    importPackage(packageValue, options = {}) {
      return repository.transaction(() => {
        const state = repository.getState(); const result = importPackage(packageValue, { ...options, existingState: state, now: now() }); const next = result.state; next.meta = next.meta || {};
        next.meta.restorePoints = [...(next.meta.restorePoints || []), { id: makeId("restore_point"), createdAt: now().toISOString(), reason: "Import package", state: clone(result.restorePoint) }].slice(-10);
        repository.replaceState(next, { persist: false }); const imported = repository.getState(); importRecord(packageValue, result, imported); addHistory({ type: "import", description: "Imported SAMT package", metadata: { restorePoint: true, packageType: packageValue?.packageType || "backup" } }); touch(); validateCurrentState(imported); return result;
      });
    },
    restoreLastImport() {
      return repository.transaction(() => {
        const state = repository.getState(); const points = (state.meta?.restorePoints || []).filter((point) => /import/i.test(point.reason || "")); const point = points.at(-1);
        if (!point?.state) throw new ValidationError("No import restore point is available."); repository.replaceState(clone(point.state), { persist: false }); addHistory({ type: "restore", description: "Restored the state before the last import", metadata: { restorePoint: true, reason: "Import package" } }); touch(); validateCurrentState(repository.getState()); return clone(repository.getState());
      });
    },
    restorePoint(id = null) {
      return repository.transaction(() => {
        const state = repository.getState(); const point = id ? (state.meta?.restorePoints || []).find((candidate) => candidate.id === id) : state.meta?.restorePoints?.at(-1);
        if (!point?.state) throw new ValidationError("That restore point is no longer available."); repository.replaceState(clone(point.state), { persist: false }); addHistory({ type: "restore", description: `Restored point ${point.reason || point.id || "from Settings"}`, metadata: { restorePoint: true, restorePointId: point.id || null } }); touch(); validateCurrentState(repository.getState()); return clone(repository.getState());
      });
    },
    clearEverything() {
      return repository.transaction(() => {
        const state = repository.getState(); const point = { id: makeId("restore_point"), createdAt: now().toISOString(), reason: "Clear Everything / Start Fresh", state: clone(state) }; const empty = createEmptyState(now()); empty.meta.restorePoints = [...(state.meta?.restorePoints || []), point].slice(-10); repository.replaceState(empty, { persist: false }); validateCurrentState(repository.getState()); return clone(repository.getState());
      });
    }
  };
}
