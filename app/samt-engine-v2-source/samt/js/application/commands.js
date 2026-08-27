import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { deepClone, normalizeName, normalizedNameKey } from "../shared/validation.js";
import { createActionDefinition, updateActionDefinition } from "../domain/actions.js";
import { createBlockDefinition, isExecutableBlock, updateBlockDefinition } from "../domain/blocks.js";
import { validateBlockGraph, getBlocksContainingAction, getDescendantActionIds } from "../domain/relationships.js";
import { actionCompletion } from "../domain/evaluation.js";
import { assertOneActiveActivation, pauseActivation, resumeActivation } from "../domain/activations.js";
import { createRun, assertNoRunningRun, finishRun, pauseRun, resumeRun, RUNNING_RUN_STATUSES } from "../domain/runs.js";
import { completeOccurrence as completeOccurrenceDomain, CLOSED_OCCURRENCE_STATES, OPEN_OCCURRENCE_STATES, resolveOccurrenceStatus } from "../domain/occurrences.js";
import { advanceCycle as advanceCycleDomain, distributeCycleFrequency, getCurrentCyclePosition } from "../domain/cycles.js";
import { historyEvent } from "../domain/history.js";
import { openPeriodRecord, closePeriodRecord } from "../domain/periods.js";
import { calculateTargetProgress, normalizeTargetConfig } from "../domain/targets.js";
import { evaluateAvoidActionPeriod, evaluateAvoidPeriod, validateAvoidEvaluation } from "../domain/avoid.js";
import { EVENTS, domainEvent } from "./events.js";
import { calculateRoutineProgress } from "../domain/routines.js";
import { calculateWorkflowProgress } from "../domain/workflows.js";
import { calculateProjectProgress } from "../domain/projects.js";
import { aggregateLogsUnique } from "../domain/logs.js";

function assertUniqueName(items, name, exceptId, kind) {
  const key = normalizedNameKey(name);
  if ((items || []).some((item) => item.id !== exceptId && normalizedNameKey(item.name) === key)) throw new ConflictError(`${kind} name already exists: ${normalizeName(name)}`);
}

export function createActionCommand(state, input, context) {
  assertUniqueName(state.actions, input.name, null, "Action");
  const action = createActionDefinition(input, { id: context.id("action"), now: context.now });
  state.actions.push(action);
  return { value: action, events: [] };
}

export function updateActionCommand(state, actionId, patch, context) {
  const index = state.actions.findIndex((item) => item.id === actionId);
  if (index < 0) throw new NotFoundError(`Action not found: ${actionId}`);
  assertUniqueName(state.actions, patch.name || state.actions[index].name, actionId, "Action");
  const action = updateActionDefinition(state.actions[index], patch, context.now);
  state.actions[index] = action;
  return { value: action, events: [] };
}

export function createBlockCommand(state, input, context) {
  assertUniqueName(state.blocks, input.name, null, "Block");
  const block = createBlockDefinition(input, { id: context.id("block"), now: context.now });
  state.blocks.push(block);
  validateBlockGraph(state);
  return { value: block, events: [] };
}

export function updateBlockCommand(state, blockId, patch, context) {
  const index = state.blocks.findIndex((item) => item.id === blockId);
  if (index < 0) throw new NotFoundError(`Block not found: ${blockId}`);
  assertUniqueName(state.blocks, patch.name || state.blocks[index].name, blockId, "Block");
  const block = updateBlockDefinition(state.blocks[index], patch, context.now);
  state.blocks[index] = block;
  validateBlockGraph(state);
  return { value: block, events: [] };
}

export function addBlockChildCommand(state, blockId, input, context) {
  const index = state.blocks.findIndex((item) => item.id === blockId);
  if (index < 0) throw new NotFoundError(`Block not found: ${blockId}`);
  const kind = input.kind;
  if (!['action', 'block'].includes(kind)) throw new ValidationError("A child must be an Action or Block.");
  const referenced = state[kind === "action" ? "actions" : "blocks"].find((item) => item.id === input.refId);
  if (!referenced) throw new NotFoundError(`${kind === "action" ? "Action" : "Block"} not found: ${input.refId}`);
  if (kind === "block" && input.refId === blockId) throw new ValidationError("A Block cannot contain itself.");
  const parent = state.blocks[index];
  if ((parent.children || []).some((item) => item.kind === kind && item.refId === input.refId)) throw new ConflictError(`${referenced.name} is already a direct child of ${parent.name}.`);
  const relationship = {
    id: context.id("relationship"),
    kind,
    refId: input.refId,
    order: parent.children?.length || 0,
    required: Boolean(input.required),
    ...(parent.type === "cycle" ? { frequency: Number(input.frequency || 1) } : {}),
    ...(input.schedule ? { schedule: deepClone(input.schedule) } : {}),
    ...(input.avoidEvaluation ? { avoidEvaluation: deepClone(input.avoidEvaluation) } : {})
  };
  const requiredRelIds = input.required
    ? [...new Set([...(parent.completion?.requiredRelIds || []), relationship.id])]
    : [...(parent.completion?.requiredRelIds || [])];
  state.blocks[index] = updateBlockDefinition(parent, {
    children: [...(parent.children || []), relationship],
    completion: { ...(parent.completion || {}), requiredRelIds }
  }, context.now);
  validateBlockGraph(state);
  return { value: relationship, events: [] };
}

export function removeBlockChildCommand(state, blockId, relationshipId, context) {
  const index = state.blocks.findIndex((item) => item.id === blockId);
  if (index < 0) throw new NotFoundError(`Block not found: ${blockId}`);
  const parent = state.blocks[index];
  const relationship = (parent.children || []).find((item) => item.id === relationshipId);
  if (!relationship) throw new NotFoundError(`Relationship not found: ${relationshipId}`);
  for (const occurrence of state.occurrences || []) {
    if (occurrence.relationshipId === relationshipId && OPEN_OCCURRENCE_STATES.includes(occurrence.status)) Object.assign(occurrence, completeOccurrenceDomain(occurrence, context.now, "skipped"));
  }
  state.blocks[index] = updateBlockDefinition(parent, {
    children: (parent.children || []).filter((item) => item.id !== relationshipId).map((item, order) => ({ ...item, order })),
    completion: { ...(parent.completion || {}), requiredRelIds: (parent.completion?.requiredRelIds || []).filter((id) => id !== relationshipId) }
  }, context.now);
  validateBlockGraph(state);
  return { value: relationship, events: [] };
}

export function setPrimaryProjectCommand(state, blockId, context) {
  if (blockId != null) {
    const project = state.blocks.find((item) => item.id === blockId);
    if (!project || project.type !== "project") throw new ValidationError("Primary Project must be a Project Block.");
    if (project.status === "archived") throw new ValidationError("An archived Project cannot be primary.");
  }
  state.settings.primaryProjectId = blockId || null;
  state.settings.updatedAt = context.now;
  return { value: state.settings.primaryProjectId, events: [] };
}

function logValues(action, input) {
  if (action.completion.method === "time") {
    const duration = Number(input.durationPerformed ?? input.durationMinutes ?? input.duration ?? 0);
    if (!(duration > 0)) throw new ValidationError("A time log must contain positive time.");
    return { durationPerformed: duration, quantityPerformed: null, completionContribution: duration };
  }
  const quantity = Number(input.quantityPerformed ?? input.quantity ?? 1);
  if (!(quantity > 0) || !Number.isInteger(quantity)) throw new ValidationError("A quantity log must be a positive whole number.");
  return { durationPerformed: null, quantityPerformed: quantity, completionContribution: quantity };
}

function validateResultValue(state, action, input) {
  const mode = action.result?.mode || "none";
  if (mode === "none") return { resultValue: null, unitId: null, unitNameSnapshot: null };
  const value = Number(input.resultValue);
  if (!Number.isFinite(value)) throw new ValidationError("This Action requires a valid Result value.");
  if (mode === "percentage" && (value < 0 || value > 100)) throw new ValidationError("Percentage Result must be between 0 and 100.");
  if (mode === "score" && (value < 0 || value > Number(action.result.scoreMax))) throw new ValidationError("Score Result must fit its configured maximum.");
  const unitId = mode === "measurement" ? (input.unitId || action.result.unitId || null) : null;
  if (mode === "measurement" && !unitId) throw new ValidationError("Measurement Result requires a Unit.");
  const unit = unitId ? state.units.find((item) => item.id === unitId) : null;
  if (unitId && !unit) throw new ValidationError("Measurement Unit was not found.");
  const allowed = action.result.allowedUnitIds || (action.result.unitId ? [action.result.unitId] : []);
  if (mode === "measurement" && allowed.length && !allowed.includes(unitId)) throw new ValidationError("That Unit is not allowed for this Action.");
  return { resultValue: value, unitId, unitNameSnapshot: unit ? (unit.symbol || unit.name) : null };
}

function normalizeEventTimestamp(input, context) {
  const date = new Date(input.timestamp || input.eventAt || context.now);
  if (Number.isNaN(date.getTime())) throw new ValidationError("Action Log time is invalid.");
  return date.toISOString();
}

function requestedIds(input, singular, plural) {
  return [...new Set([...(Array.isArray(input[plural]) ? input[plural] : []), ...(input[singular] ? [input[singular]] : [])])];
}

function occurrenceContextKey(occurrence) {
  return occurrence.relationshipId || `${occurrence.parentBlockId || occurrence.blockId || occurrence.contextBlockId || "none"}:${occurrence.actionId}`;
}

function selectLinkedOccurrences(state, action, input, eventAt) {
  if (action.direction === "avoid") return [];
  const explicitIds = requestedIds(input, "occurrenceId", "occurrenceIds");
  if (explicitIds.length) return explicitIds.map((id) => {
    const occurrence = state.occurrences.find((item) => item.id === id);
    if (!occurrence) throw new NotFoundError(`Occurrence not found: ${id}`);
    if (occurrence.actionId !== action.id) throw new ValidationError("Occurrence belongs to a different Action.", { occurrenceId: id, actionId: action.id });
    if (!OPEN_OCCURRENCE_STATES.includes(occurrence.status)) throw new ConflictError("A new log cannot be attached to a closed Occurrence.", { occurrenceId: id, status: occurrence.status });
    return occurrence;
  });
  const instant = new Date(eventAt).getTime();
  const eligible = (state.occurrences || []).filter((item) => item.actionId === action.id
    && OPEN_OCCURRENCE_STATES.includes(item.status)
    && (!item.availableAt || Date.parse(item.availableAt) <= instant)
    && (!item.dueAt || item.expiryPolicy !== "expire" || instant < Date.parse(item.dueAt)));
  const newestByContext = new Map();
  for (const occurrence of eligible) {
    const key = occurrenceContextKey(occurrence);
    const existing = newestByContext.get(key);
    if (!existing || Date.parse(occurrence.availableAt || occurrence.createdAt || 0) > Date.parse(existing.availableAt || existing.createdAt || 0)) newestByContext.set(key, occurrence);
  }
  return [...newestByContext.values()];
}

function relationshipContainsAction(state, relationship, actionId) {
  if (!relationship) return false;
  return relationship.kind === "action" ? relationship.refId === actionId : getDescendantActionIds(state, relationship.refId).has(actionId);
}

function runAcceptsAction(state, run, actionId) {
  const block = state.blocks.find((item) => item.id === run.blockId);
  if (!block || !getDescendantActionIds(state, run.blockId).has(actionId)) return false;
  if (!["workflow", "cycle"].includes(block.type)) return true;
  const currentId = run.progress?.currentRelationshipId || run.currentRelationshipId;
  const current = currentId ? block.children.find((relationship) => relationship.id === currentId) : block.children[0];
  return relationshipContainsAction(state, current, actionId);
}

function selectLinkedRuns(state, actionId, input) {
  const explicitIds = requestedIds(input, "runId", "runIds");
  if (explicitIds.length) return explicitIds.map((id) => {
    const run = state.runs.find((item) => item.id === id);
    if (!run) throw new NotFoundError(`Run not found: ${id}`);
    if (!RUNNING_RUN_STATUSES.includes(run.status)) throw new ValidationError("Only a running Run can receive a new Action Log.", { runId: id });
    if (!runAcceptsAction(state, run, actionId)) throw new ValidationError("Action is not eligible for that Run's current item.", { runId: id, actionId });
    return run;
  });
  return (state.runs || []).filter((run) => RUNNING_RUN_STATUSES.includes(run.status) && runAcceptsAction(state, run, actionId));
}

function completionDefinitionForOccurrence(occurrence, action) {
  return { ...action, completion: occurrence.completionSnapshot || action?.completion || { method: "quantity", target: 1 } };
}

function recomputeOccurrence(state, occurrence, now) {
  const action = state.actions.find((item) => item.id === occurrence.actionId);
  const definition = completionDefinitionForOccurrence(occurrence, action);
  const method = definition.completion.method;
  occurrence.actionLogIds = [...new Set([...(occurrence.actionLogIds || occurrence.logIds || [])])].filter((id) => state.actionLogs.some((log) => log.id === id));
  occurrence.logIds = [...occurrence.actionLogIds];
  const logs = occurrence.actionLogIds.map((id) => state.actionLogs.find((log) => log.id === id)).filter(Boolean).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const log of state.actionLogs) log.completionOccurrenceIds = (log.completionOccurrenceIds || []).filter((id) => id !== occurrence.id);
  let total = 0;
  let completionLog = null;
  for (const log of logs) {
    total += Number(method === "time" ? (log.durationPerformed ?? log.durationMinutes ?? 0) : (log.quantityPerformed ?? log.quantity ?? 0));
    if (!completionLog && actionCompletion(definition, total).complete) completionLog = log;
  }
  occurrence.actual = total;
  if (method === "time") occurrence.durationMinutesActual = total; else occurrence.quantityActual = total;
  const completion = actionCompletion(definition, total);
  if (completion.complete) {
    occurrence.status = "completed";
    occurrence.completedAt = completionLog?.timestamp || now;
    completionLog.completionOccurrenceIds = [...new Set([...(completionLog.completionOccurrenceIds || []), occurrence.id])];
  } else {
    occurrence.completedAt = null;
    occurrence.status = resolveOccurrenceStatus({ ...occurrence, status: total > 0 ? "partial" : "available", actual: total }, now);
  }
  for (const log of logs) log.completionCount = (log.completionOccurrenceIds || []).length || log.standaloneCompletionCount ? 1 : 0;
  occurrence.updatedAt = now;
}

function childStatesForRun(state, run, block) {
  const runLogs = new Set(run.actionLogIds || []);
  return (block.children || []).map((relationship) => {
    if (relationship.kind === "action") {
      const action = state.actions.find((item) => item.id === relationship.refId);
      const logs = state.actionLogs.filter((log) => runLogs.has(log.id) && log.actionId === relationship.refId);
      const actual = logs.reduce((sum, log) => sum + Number(action?.completion?.method === "time" ? (log.durationPerformed ?? log.durationMinutes ?? 0) : (log.quantityPerformed ?? log.quantity ?? 0)), 0);
      return { relationshipId: relationship.id, completed: action ? actionCompletion(action, actual).complete : false, actual };
    }
    const nestedRun = state.runs.find((item) => item.id !== run.id && item.blockId === relationship.refId && item.status === "completed" && Date.parse(item.endAt || 0) >= Date.parse(run.startAt || 0));
    return { relationshipId: relationship.id, completed: Boolean(nestedRun), runId: nestedRun?.id || null };
  });
}

function projectTargetResults(state, run, block, now) {
  const runLogIds = new Set(run.actionLogIds || []);
  const runLogs = (state.actionLogs || []).filter((log) => runLogIds.has(log.id));
  return (block.projectTargets || []).map((target) => {
    if (target.blockId) {
      const targetBlock = state.blocks.find((item) => item.id === target.blockId && item.type === "target");
      if (!targetBlock) return { id: target.id, reached: false, actual: 0, target: null };
      const progress = calculateTargetProgress({ state, block: targetBlock, now, timezone: state.settings?.timezone || "Europe/London" });
      return { id: target.id, blockId: target.blockId, ...progress };
    }
    const metric = target.metric || target.targetMetric || "quantity";
    const targetValue = Number(target.targetValue ?? target.value ?? target.amount ?? 0);
    const aggregate = aggregateLogsUnique(runLogs, { metric, actionIds: target.actionId ? [target.actionId] : undefined });
    return { id: target.id, actionId: target.actionId || null, metric, actual: aggregate.actual, target: targetValue, reached: targetValue > 0 && aggregate.actual >= targetValue, logIds: aggregate.logIds };
  });
}

function recomputeRun(state, run, now) {
  run.actionLogIds = [...new Set([...(run.actionLogIds || run.logIds || [])])].filter((id) => state.actionLogs.some((log) => log.id === id));
  run.logIds = [...run.actionLogIds];
  const block = state.blocks.find((item) => item.id === run.blockId);
  if (!block) return;
  const childStates = childStatesForRun(state, run, block);
  let progress = { childStates };
  if (block.type === "routine") progress = { ...progress, ...calculateRoutineProgress({ block, childStates }) };
  else if (block.type === "workflow") progress = { ...progress, ...calculateWorkflowProgress({ block, childStates }) };
  else if (block.type === "project") {
    const targetResults = projectTargetResults(state, run, block, now);
    progress = { ...progress, targetResults, ...calculateProjectProgress({ block, childStates, targetResults }) };
  }
  run.progress = progress;
  run.currentRelationshipId = progress.currentRelationshipId || null;
  if ((progress.autoFinish || (block.type === "workflow" && progress.finished)) && RUNNING_RUN_STATUSES.includes(run.status)) Object.assign(run, finishRun(run, now));
  run.updatedAt = now;
}

function attachLogToContexts(state, log, linkedOccurrences, linkedRuns, now) {
  for (const occurrence of linkedOccurrences) {
    occurrence.actionLogIds = [...new Set([...(occurrence.actionLogIds || occurrence.logIds || []), log.id])];
    recomputeOccurrence(state, occurrence, now);
  }
  for (const run of linkedRuns) {
    run.actionLogIds = [...new Set([...(run.actionLogIds || run.logIds || []), log.id])];
    recomputeRun(state, run, now);
  }
}

function persistAutoFinishedRuns(state, runs, context) {
  const events = [];
  for (const run of runs.filter((item) => item.status === "completed" && item.endAt === context.now)) {
    const historyId = `history_${run.id}_finished`;
    if (!state.history.some((item) => item.id === historyId)) state.history.push(historyEvent({ id: historyId, type: "run", event: "run_finished", objectType: "block", objectId: run.blockId, nameSnapshot: run.blockNameSnapshot, description: "Run finished automatically", timestamp: context.now, references: { runId: run.id } }));
    events.push(domainEvent(EVENTS.RUN_FINISHED, { runId: run.id, blockId: run.blockId, automatic: true }, context.now));
  }
  return events;
}

function detachLogFromContexts(state, logId, now) {
  for (const occurrence of state.occurrences || []) {
    const ids = [...new Set([...(occurrence.actionLogIds || []), ...(occurrence.logIds || [])])];
    if (!ids.includes(logId)) continue;
    occurrence.actionLogIds = ids.filter((id) => id !== logId);
    recomputeOccurrence(state, occurrence, now);
  }
  for (const run of state.runs || []) {
    const ids = [...new Set([...(run.actionLogIds || []), ...(run.logIds || [])])];
    if (!ids.includes(logId)) continue;
    run.actionLogIds = ids.filter((id) => id !== logId);
    recomputeRun(state, run, now);
  }
}

function buildActionLog(state, action, input, context, existing = null) {
  const values = logValues(action, input);
  const result = validateResultValue(state, action, input);
  const eventAt = normalizeEventTimestamp(input, context);
  const occurrenceOverride = input.occurrenceId != null || input.occurrenceIds != null;
  const runOverride = input.runId != null || input.runIds != null;
  const linkedOccurrences = existing && !occurrenceOverride
    ? (existing.linkedOccurrenceIds || []).map((id) => state.occurrences.find((item) => item.id === id)).filter(Boolean)
    : selectLinkedOccurrences(state, action, input, eventAt);
  const linkedRuns = existing && !runOverride
    ? (existing.linkedRunIds || []).map((id) => state.runs.find((item) => item.id === id)).filter(Boolean)
    : selectLinkedRuns(state, action.id, input);
  const linkedBlocks = getBlocksContainingAction(state, action.id, true);
  const standaloneCompletionCount = linkedOccurrences.length ? 0 : (actionCompletion(action, values.completionContribution).complete ? 1 : 0);
  const log = {
    ...(existing || {}),
    id: existing?.id || context.id("log"),
    actionId: action.id,
    actionNameSnapshot: action.name,
    directionSnapshot: action.direction,
    timestamp: eventAt,
    eventAt,
    ...values,
    durationMinutes: values.durationPerformed || 0,
    quantity: values.quantityPerformed || 0,
    completionMethodSnapshot: action.completion.method,
    completionTargetSnapshot: action.completion.method === "time" ? Number(action.completion.minimumMinutes ?? action.completion.target ?? 0) : Number(action.completion.target || 1),
    completionOccurrenceIds: [],
    standaloneCompletionCount,
    completionCount: standaloneCompletionCount,
    tagIdsSnapshot: [...(action.tagIds || [])],
    categoryIdsSnapshot: Array.from(new Set((action.tagIds || []).map((tagId) => state.tags.find((item) => item.id === tagId)?.categoryId).filter(Boolean))),
    resultTypeSnapshot: action.result?.mode || "none",
    resultValue: result.resultValue,
    scoreMaximumSnapshot: action.result?.scoreMax ?? null,
    unitId: result.unitId,
    unitNameSnapshot: input.unitNameSnapshot || result.unitNameSnapshot,
    linkedRunIds: linkedRuns.map((item) => item.id),
    linkedOccurrenceIds: linkedOccurrences.map((item) => item.id),
    linkedBlockIds: linkedBlocks.map((item) => item.id),
    note: input.note || "",
    createdAt: existing?.createdAt || context.now,
    updatedAt: existing ? context.now : undefined
  };
  if (!existing) delete log.updatedAt;
  return { log, linkedOccurrences, linkedRuns };
}

export function logActionCommand(state, actionId, input, context) {
  const action = state.actions.find((item) => item.id === actionId);
  if (!action) throw new NotFoundError(`Action not found: ${actionId}`);
  if (action.status === "archived") throw new ValidationError("Archived Actions cannot receive new logs.");
  const built = buildActionLog(state, action, input, context);
  state.actionLogs.push(built.log);
  attachLogToContexts(state, built.log, built.linkedOccurrences, built.linkedRuns, context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "action_log", event: "action_logged", objectType: "action", objectId: action.id, nameSnapshot: action.name, description: `${action.name} logged`, timestamp: built.log.timestamp, references: { actionLogId: built.log.id, linkedBlockIds: built.log.linkedBlockIds, linkedRunIds: built.log.linkedRunIds, linkedOccurrenceIds: built.log.linkedOccurrenceIds, recordedAt: context.now } }));
  return { value: built.log, events: [domainEvent(EVENTS.ACTION_LOGGED, { actionLogId: built.log.id, actionId, linkedBlockIds: built.log.linkedBlockIds }, context.now), ...persistAutoFinishedRuns(state, built.linkedRuns, context)] };
}

export function updateActionLogCommand(state, logId, patch, context) {
  const index = state.actionLogs.findIndex((item) => item.id === logId);
  if (index < 0) throw new NotFoundError(`Action Log not found: ${logId}`);
  const previous = deepClone(state.actionLogs[index]);
  const action = state.actions.find((item) => item.id === previous.actionId);
  if (!action) throw new ValidationError("The Action definition is unavailable; preserve or delete this historical log instead.");
  state.actionLogs.splice(index, 1);
  detachLogFromContexts(state, logId, context.now);
  const built = buildActionLog(state, action, { ...previous, ...patch }, context, previous);
  state.actionLogs.splice(index, 0, built.log);
  attachLogToContexts(state, built.log, built.linkedOccurrences, built.linkedRuns, context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "correction", event: "action_log_updated", objectType: "action", objectId: action.id, nameSnapshot: built.log.actionNameSnapshot, description: "Action Log corrected", timestamp: context.now, references: { actionLogId: logId, previousActionLogSnapshot: previous } }));
  return { value: built.log, events: [domainEvent(EVENTS.ACTION_LOG_UPDATED, { actionLogId: logId, actionId: action.id }, context.now), ...persistAutoFinishedRuns(state, built.linkedRuns, context)] };
}

export function deleteActionLogCommand(state, logId, context) {
  const index = state.actionLogs.findIndex((item) => item.id === logId);
  if (index < 0) throw new NotFoundError(`Action Log not found: ${logId}`);
  const [log] = state.actionLogs.splice(index, 1);
  detachLogFromContexts(state, logId, context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "correction", event: "action_log_deleted", objectType: "action", objectId: log.actionId, nameSnapshot: log.actionNameSnapshot, description: "Action Log deleted", timestamp: context.now, references: { deletedActionLogSnapshot: deepClone(log) } }));
  return { value: log, events: [domainEvent(EVENTS.ACTION_LOG_DELETED, { actionLogId: logId }, context.now)] };
}

export function activateBlockCommand(state, blockId, config, context) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) throw new NotFoundError(`Block not found: ${blockId}`);
  assertOneActiveActivation(state.activations, blockId);
  const activation = { id: context.id("activation"), blockId, blockNameSnapshot: block.name, status: config.status || "manual", startAt: config.startAt || context.now, repeat: config.repeat || { mode: "none" }, deadline: config.deadline || null, note: config.note || "", cycleState: block.type === "cycle" ? { currentPosition: 0, currentRound: 1, completedRounds: 0 } : null, roundSnapshot: block.type === "cycle" ? distributeCycleFrequency(block.children) : null, createdAt: context.now, updatedAt: context.now };
  state.activations.push(activation);
  state.history.push(historyEvent({ id: context.id("history"), type: "activation", event: "block_activated", objectType: "block", objectId: block.id, nameSnapshot: block.name, description: `${block.name} activated`, timestamp: context.now, references: { activationId: activation.id } }));
  return { value: activation, events: [domainEvent(EVENTS.BLOCK_ACTIVATED, { activationId: activation.id, blockId }, context.now)] };
}

export function pauseBlockCommand(state, activationId, resumeAt, context) {
  const index = state.activations.findIndex((item) => item.id === activationId);
  if (index < 0) throw new NotFoundError(`Activation not found: ${activationId}`);
  if (state.activations[index].status === "paused") throw new ConflictError("This Block Activation is already paused.", { activationId });
  state.activations[index] = pauseActivation(state.activations[index], context.now, resumeAt);
  state.history.push(historyEvent({ id: context.id("history"), type: "activation", event: "block_paused", objectType: "block", objectId: state.activations[index].blockId, nameSnapshot: state.activations[index].blockNameSnapshot, description: "Block Activation paused", timestamp: context.now, references: { activationId } }));
  return { value: state.activations[index], events: [domainEvent(EVENTS.BLOCK_PAUSED, { activationId }, context.now)] };
}

export function resumeBlockCommand(state, activationId, context) {
  const index = state.activations.findIndex((item) => item.id === activationId);
  if (index < 0) throw new NotFoundError(`Activation not found: ${activationId}`);
  if (state.activations[index].status !== "paused") throw new ConflictError("Only a paused Block Activation can be resumed.", { activationId });
  state.activations[index] = resumeActivation(state.activations[index], context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "activation", event: "block_resumed", objectType: "block", objectId: state.activations[index].blockId, nameSnapshot: state.activations[index].blockNameSnapshot, description: "Block Activation resumed", timestamp: context.now, references: { activationId } }));
  return { value: state.activations[index], events: [domainEvent(EVENTS.BLOCK_RESUMED, { activationId }, context.now)] };
}

function snapshotBlock(state, blockId, seen = new Set()) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block || seen.has(blockId)) return null;
  const nextSeen = new Set(seen).add(blockId);
  return { kind: "block", id: block.id, type: block.type, nameSnapshot: block.name, completion: deepClone(block.completion), typeConfig: deepClone(block.typeConfig), children: (block.children || []).map((relationship) => relationship.kind === "block" ? { relationship: deepClone(relationship), node: snapshotBlock(state, relationship.refId, nextSeen) } : { relationship: deepClone(relationship), action: deepClone(state.actions.find((item) => item.id === relationship.refId)) }).filter((item) => item.node || item.action) };
}

export function startRunCommand(state, blockId, activationId, context) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) throw new NotFoundError(`Block not found: ${blockId}`);
  if (block.status !== "active") throw new ValidationError("Only an active Block can start a Run.");
  if (!isExecutableBlock(block)) throw new ValidationError(`${block.type === "collection" ? "Collections" : block.type === "action_list" ? "Action Lists" : "Target Blocks"} do not create Runs.`);
  assertNoRunningRun(state.runs, blockId);
  const activation = activationId ? state.activations.find((item) => item.id === activationId) : null;
  if (activationId && !activation) throw new NotFoundError(`Activation not found: ${activationId}`);
  if (activation && activation.blockId !== blockId) throw new ValidationError("Activation belongs to a different Block.");
  if (activation?.status === "paused") throw new ValidationError("Resume the Activation before starting a Run.");
  const run = createRun({ id: context.id("run"), block, activation, now: context.now, snapshot: snapshotBlock(state, blockId) });
  state.runs.push(run);
  recomputeRun(state, run, context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "run", event: "run_started", objectType: "block", objectId: block.id, nameSnapshot: block.name, description: `${block.name} Run started`, timestamp: context.now, references: { runId: run.id, activationId: activation?.id || null } }));
  return { value: run, events: [domainEvent(EVENTS.RUN_STARTED, { runId: run.id, blockId }, context.now)] };
}

export function finishRunCommand(state, runId, context) {
  const index = state.runs.findIndex((item) => item.id === runId);
  if (index < 0) throw new NotFoundError(`Run not found: ${runId}`);
  if (!RUNNING_RUN_STATUSES.includes(state.runs[index].status) && state.runs[index].status !== "paused") throw new ConflictError("This Run is already closed.");
  recomputeRun(state, state.runs[index], context.now);
  const block = state.blocks.find((item) => item.id === state.runs[index].blockId);
  if (block?.type === "workflow" && !state.runs[index].progress?.finished) throw new ConflictError("Workflow cannot finish before its final required step.");
  if (block?.type === "routine" && block.completion?.mode !== "manual" && !state.runs[index].progress?.satisfied) throw new ConflictError("Routine completion rules are not satisfied.");
  if (block?.type === "project" && block.completion?.mode !== "manual" && !state.runs[index].progress?.complete) throw new ConflictError("Project completion rules are not satisfied.");
  state.runs[index] = finishRun(state.runs[index], context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "run", event: "run_finished", objectType: "block", objectId: state.runs[index].blockId, nameSnapshot: state.runs[index].blockNameSnapshot, description: "Run finished", timestamp: context.now, references: { runId } }));
  return { value: state.runs[index], events: [domainEvent(EVENTS.RUN_FINISHED, { runId, blockId: state.runs[index].blockId }, context.now)] };
}

export function pauseRunCommand(state, runId, resumeAt, context) {
  const index = state.runs.findIndex((item) => item.id === runId);
  if (index < 0) throw new NotFoundError(`Run not found: ${runId}`);
  if (!RUNNING_RUN_STATUSES.includes(state.runs[index].status)) throw new ConflictError("Only a running Run can be paused.");
  state.runs[index] = pauseRun(state.runs[index], context.now, resumeAt || null);
  state.history.push(historyEvent({ id: context.id("history"), type: "run", event: "run_paused", objectType: "block", objectId: state.runs[index].blockId, nameSnapshot: state.runs[index].blockNameSnapshot, description: "Run paused", timestamp: context.now, references: { runId } }));
  return { value: state.runs[index], events: [domainEvent(EVENTS.RUN_PAUSED, { runId, blockId: state.runs[index].blockId }, context.now)] };
}

export function resumeRunCommand(state, runId, context) {
  const index = state.runs.findIndex((item) => item.id === runId);
  if (index < 0) throw new NotFoundError(`Run not found: ${runId}`);
  if (state.runs[index].status !== "paused") throw new ConflictError("Only a paused Run can be resumed.");
  assertNoRunningRun(state.runs.filter((item) => item.id !== runId), state.runs[index].blockId);
  state.runs[index] = resumeRun(state.runs[index], context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "run", event: "run_resumed", objectType: "block", objectId: state.runs[index].blockId, nameSnapshot: state.runs[index].blockNameSnapshot, description: "Run resumed", timestamp: context.now, references: { runId } }));
  return { value: state.runs[index], events: [domainEvent(EVENTS.RUN_RESUMED, { runId, blockId: state.runs[index].blockId }, context.now)] };
}

export function completeOccurrenceCommand(state, occurrenceId, status, context) {
  const index = state.occurrences.findIndex((item) => item.id === occurrenceId);
  if (index < 0) throw new NotFoundError(`Occurrence not found: ${occurrenceId}`);
  if (CLOSED_OCCURRENCE_STATES.includes(state.occurrences[index].status)) throw new ConflictError("This Occurrence is already closed.", { occurrenceId, status: state.occurrences[index].status });
  state.occurrences[index] = completeOccurrenceDomain(state.occurrences[index], context.now, status || "completed");
  const occurrence = state.occurrences[index];
  const eventName = occurrence.status === "missed" ? "occurrence_missed" : occurrence.status === "skipped" ? "occurrence_skipped" : "occurrence_completed";
  state.history.push(historyEvent({ id: context.id("history"), type: "occurrence", event: eventName, objectType: "action", objectId: occurrence.actionId, nameSnapshot: occurrence.actionNameSnapshot, description: eventName.replaceAll("_", " "), timestamp: context.now, references: { occurrenceId } }));
  const eventType = occurrence.status === "missed" ? EVENTS.OCCURRENCE_MISSED : occurrence.status === "skipped" ? EVENTS.OCCURRENCE_SKIPPED : EVENTS.OCCURRENCE_COMPLETED;
  return { value: occurrence, events: [domainEvent(eventType, { occurrenceId, status: occurrence.status }, context.now)] };
}

export function advanceCycleCommand(state, activationId, context) {
  const activation = state.activations.find((item) => item.id === activationId);
  if (!activation) throw new NotFoundError(`Activation not found: ${activationId}`);
  const block = state.blocks.find((item) => item.id === activation.blockId);
  if (!block || block.type !== "cycle") throw new ValidationError("Activation does not belong to a Cycle.");
  const sequence = activation.roundSnapshot || distributeCycleFrequency(block.children);
  const openPeriod = [...(state.cyclePeriods || [])].reverse().find((item) => item.activationId === activationId && !item.closedAt && item.lifecycleStatus !== "closed");
  if (openPeriod) {
    openPeriod.itemCompleted = true;
    openPeriod.completedAt = context.now;
    openPeriod.positionCompleted = getCurrentCyclePosition(activation.cycleState || activation, sequence.length);
    openPeriod.updatedAt = context.now;
  }
  activation.cycleState = advanceCycleDomain(activation.cycleState || activation, sequence.length);
  activation.updatedAt = context.now;
  state.history.push(historyEvent({ id: context.id("history"), type: "cycle", event: "cycle_advanced", objectType: "block", objectId: block.id, nameSnapshot: block.name, description: "Cycle advanced", timestamp: context.now, references: { activationId, position: activation.cycleState.currentPosition } }));
  return { value: activation.cycleState, events: [domainEvent(EVENTS.CYCLE_ADVANCED, { activationId, blockId: block.id, position: activation.cycleState.currentPosition }, context.now)] };
}

export function startPeriodCommand(state, blockId, context) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) throw new NotFoundError(`Block not found: ${blockId}`);
  const isAvoid = block.direction === "avoid";
  const config = isAvoid ? validateAvoidEvaluation(block.typeConfig?.avoidEvaluation || {}) : normalizeTargetConfig(block);
  if (block.type !== "target" && !isAvoid) throw new ValidationError("Only Target or Avoid Blocks have evaluation periods.");
  if ((config.period.mode || config.period) !== "session") throw new ValidationError("Only per-session Blocks are started manually.");
  const collection = isAvoid ? state.avoidPeriods : state.targetPeriods;
  const existing = collection.find((item) => item.blockId === blockId && !item.closedAt && !item.periodEnd);
  if (existing) throw new ConflictError("This Block already has an open session.", { periodId: existing.id });
  const period = openPeriodRecord({ id: context.id(isAvoid ? "avoid_period" : "target_period"), block, bounds: { start: context.now, end: null }, targetSnapshot: config, now: context.now, kind: isAvoid ? "avoid" : "target" });
  period.actionIdsSnapshot = [...getDescendantActionIds(state, block.id)];
  if (isAvoid) period.evaluationSnapshot = config;
  collection.push(period);
  return { value: period, events: [domainEvent(EVENTS.PERIOD_OPENED, { periodId: period.id, blockId }, context.now)] };
}

export function closePeriodCommand(state, periodId, context) {
  const targetIndex = state.targetPeriods.findIndex((item) => item.id === periodId);
  const avoidIndex = state.avoidPeriods.findIndex((item) => item.id === periodId);
  const isAvoid = avoidIndex >= 0;
  const collection = isAvoid ? state.avoidPeriods : state.targetPeriods;
  const index = isAvoid ? avoidIndex : targetIndex;
  if (index < 0) throw new NotFoundError(`Period not found: ${periodId}`);
  const record = collection[index];
  if (record.closedAt) throw new ConflictError("This period is already closed.");
  const block = state.blocks.find((item) => item.id === record.blockId);
  if (!block) throw new NotFoundError(`Block not found: ${record.blockId}`);
  // A manually closed session includes a log recorded at the same instant as
  // the close command. Calendar periods remain end-exclusive so boundary logs
  // belong to exactly one day/week/month.
  const bounds = { start: record.periodStart, end: record.periodEnd || context.now, endInclusive: true, mode: "session" };
  const evaluation = isAvoid
    ? record.actionId
      ? evaluateAvoidActionPeriod({ logs: state.actionLogs, actionId: record.actionId, evaluation: record.evaluationSnapshot, now: context.now, timezone: context.timezone, bounds })
      : evaluateAvoidPeriod({ state, block, now: context.now, timezone: context.timezone, bounds, config: record.evaluationSnapshot || record.targetSnapshot, actionIds: record.actionIdsSnapshot || null })
    : calculateTargetProgress({ state, block, now: context.now, timezone: context.timezone, bounds, closed: true, config: record.targetSnapshot, actionIds: record.actionIdsSnapshot || null });
  collection[index] = closePeriodRecord({ ...record, periodEnd: bounds.end }, evaluation, context.now);
  state.history.push(historyEvent({ id: context.id("history"), type: "period", event: isAvoid ? "avoid_period_closed" : "target_period_closed", objectType: record.actionId ? "action" : "block", objectId: record.actionId || block.id, nameSnapshot: record.actionNameSnapshot || block.name, description: `${record.actionNameSnapshot || block.name} period closed`, timestamp: context.now, references: { periodId, actionLogIds: evaluation.logIds || [] } }));
  const events = [domainEvent(EVENTS.PERIOD_CLOSED, { periodId, blockId: block.id, status: evaluation.status }, context.now)];
  if (!isAvoid && evaluation.reached) events.push(domainEvent(EVENTS.TARGET_REACHED, { periodId, blockId: block.id }, context.now));
  if (isAvoid && evaluation.status === "failed") events.push(domainEvent(EVENTS.AVOID_FAILED, { periodId, blockId: block.id }, context.now));
  return { value: collection[index], events };
}

export function moveDefinitionToBinCommand(state, kind, id, context) {
  const collection = kind === "action" ? state.actions : state.blocks;
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) throw new NotFoundError(`${kind} not found: ${id}`);
  const [snapshot] = collection.splice(index, 1);
  const removedRelationships = [];
  for (const block of state.blocks) {
    const removed = (block.children || []).filter((child) => child.kind === kind && child.refId === id);
    if (!removed.length) continue;
    removedRelationships.push(...removed.map((relationship) => ({
      parentBlockId: block.id,
      relationship: deepClone(relationship),
      required: (block.completion?.requiredRelIds || []).includes(relationship.id)
    })));
    const removedIds = new Set(removed.map((relationship) => relationship.id));
    block.children = (block.children || []).filter((child) => !removedIds.has(child.id));
    block.completion = { ...(block.completion || {}), requiredRelIds: (block.completion?.requiredRelIds || []).filter((relationshipId) => !removedIds.has(relationshipId)) };
    block.typeConfig = {
      ...(block.typeConfig || {}),
      requiredChildBlockIds: (block.typeConfig?.requiredChildBlockIds || []).filter((blockId) => blockId !== id),
      ...(block.typeConfig?.avoidEvaluation ? { avoidEvaluation: { ...block.typeConfig.avoidEvaluation, requiredChildBlockIds: (block.typeConfig.avoidEvaluation.requiredChildBlockIds || []).filter((blockId) => blockId !== id) } } : {})
    };
    block.projectTargets = (block.projectTargets || []).filter((target) => kind === "action" ? target.actionId !== id : target.blockId !== id);
    block.updatedAt = context.now;
  }
  for (const block of state.blocks) {
    const before = (block.projectTargets || []).length;
    block.projectTargets = (block.projectTargets || []).filter((target) => kind === "action" ? target.actionId !== id : target.blockId !== id);
    if (block.projectTargets.length !== before) block.updatedAt = context.now;
  }
  for (const occurrence of state.occurrences || []) {
    const affected = kind === "action" ? occurrence.actionId === id : [occurrence.parentBlockId, occurrence.blockId, occurrence.contextBlockId].includes(id);
    if (affected && OPEN_OCCURRENCE_STATES.includes(occurrence.status)) Object.assign(occurrence, completeOccurrenceDomain(occurrence, context.now, "skipped"));
  }
  if (kind === "block") {
    for (const activation of state.activations || []) if (activation.blockId === id && !["completed", "archived", "cancelled"].includes(activation.status)) Object.assign(activation, { status: "archived", archivedAt: context.now, updatedAt: context.now });
    for (const run of state.runs || []) if (run.blockId === id && !["completed", "cancelled", "abandoned", "failed"].includes(run.status)) Object.assign(run, finishRun(run, context.now, "cancelled"));
    for (const key of ["targetPeriods", "avoidPeriods", "cyclePeriods"]) for (const period of state[key] || []) if (period.blockId === id && !period.closedAt) Object.assign(period, { status: "cancelled", lifecycleStatus: "closed", closedAt: context.now, updatedAt: context.now });
    if (state.settings?.primaryProjectId === id) state.settings.primaryProjectId = null;
  }
  const relatedActivationPresets = kind === "block" ? state.activationPresets.filter((preset) => preset.blockId === id) : [];
  if (relatedActivationPresets.length) state.activationPresets = state.activationPresets.filter((preset) => preset.blockId !== id);
  const binItem = { id: context.id("bin"), objectType: kind, objectId: id, nameSnapshot: snapshot.name, snapshot, removedRelationships, relatedActivationPresets, deletedAt: context.now, purgeAt: new Date(new Date(context.now).getTime() + 10 * 86400000).toISOString() };
  state.bin.push(binItem);
  return { value: binItem, events: [] };
}

export function restoreDefinitionCommand(state, binItemId, context) {
  const binIndex = state.bin.findIndex((item) => item.id === binItemId);
  if (binIndex < 0) throw new NotFoundError(`Bin item not found: ${binItemId}`);
  const item = state.bin[binIndex];
  const collection = item.objectType === "action" ? state.actions : item.objectType === "block" ? state.blocks : null;
  if (!collection) throw new ValidationError("Bin item type is invalid.");
  if (collection.some((entry) => entry.id === item.objectId)) throw new ConflictError("That stable ID already exists in the live system.", { objectId: item.objectId });
  assertUniqueName(collection, item.snapshot.name, null, item.objectType === "action" ? "Action" : "Block");
  collection.push({ ...deepClone(item.snapshot), updatedAt: context.now });
  for (const removed of item.removedRelationships || []) {
    const parent = state.blocks.find((block) => block.id === removed.parentBlockId);
    if (!parent || (parent.children || []).some((relationship) => relationship.id === removed.relationship.id)) continue;
    parent.children = [...(parent.children || []), deepClone(removed.relationship)].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    if (removed.required) parent.completion = { ...(parent.completion || {}), requiredRelIds: [...new Set([...(parent.completion?.requiredRelIds || []), removed.relationship.id])] };
    parent.updatedAt = context.now;
  }
  if (item.objectType === "block") {
    for (const preset of item.relatedActivationPresets || []) if (!state.activationPresets.some((entry) => entry.id === preset.id)) state.activationPresets.push(deepClone(preset));
  }
  validateBlockGraph(state);
  state.bin.splice(binIndex, 1);
  return { value: deepClone(item.snapshot), events: [] };
}

export function commandContext(now, idFactory = createId, timezone = "Europe/London") { return { now, timezone, id: (prefix) => idFactory(prefix) }; }
