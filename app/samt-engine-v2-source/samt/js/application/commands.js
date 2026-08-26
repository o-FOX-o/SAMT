import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { deepClone, normalizeName } from "../shared/validation.js";
import { createActionDefinition, updateActionDefinition } from "../domain/actions.js";
import { createBlockDefinition, updateBlockDefinition } from "../domain/blocks.js";
import { validateBlockGraph, getBlocksContainingAction, getDescendantActionIds } from "../domain/relationships.js";
import { actionCompletion } from "../domain/evaluation.js";
import { assertOneActiveActivation, pauseActivation } from "../domain/activations.js";
import { createRun, assertNoRunningRun, finishRun, RUNNING_RUN_STATUSES } from "../domain/runs.js";
import { completeOccurrence as completeOccurrenceDomain, OPEN_OCCURRENCE_STATES } from "../domain/occurrences.js";
import { advanceCycle as advanceCycleDomain, distributeCycleFrequency } from "../domain/cycles.js";
import { historyEvent } from "../domain/history.js";
import { openPeriodRecord, closePeriodRecord } from "../domain/periods.js";
import { calculateTargetProgress, normalizeTargetConfig } from "../domain/targets.js";
import { evaluateAvoidActionPeriod, evaluateAvoidPeriod, validateAvoidEvaluation } from "../domain/avoid.js";
import { EVENTS, domainEvent } from "./events.js";

function assertUniqueName(items, name, exceptId, kind) {
  const key = normalizeName(name).toLowerCase();
  if ((items || []).some((item) => item.id !== exceptId && normalizeName(item.name).toLowerCase() === key)) throw new ConflictError(`${kind} name already exists: ${normalizeName(name)}`);
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

export function logActionCommand(state, actionId, input, context) {
  const action = state.actions.find((item) => item.id === actionId);
  if (!action) throw new NotFoundError(`Action not found: ${actionId}`);
  if (action.status === "archived") throw new ValidationError("Archived Actions cannot receive new logs.");
  const values = logValues(action, input);
  const result = validateResultValue(state, action, input);
  const linkedOccurrences = action.direction === "avoid" ? [] : (state.occurrences || []).filter((item) => item.actionId === actionId && OPEN_OCCURRENCE_STATES.includes(item.status) && (!item.availableAt || new Date(item.availableAt) <= new Date(context.now)) && (!item.dueAt || item.expiryPolicy !== "expire" || new Date(context.now) <= new Date(item.dueAt)));
  const linkedBlocks = getBlocksContainingAction(state, actionId, true);
  const linkedRuns = (state.runs || []).filter((run) => RUNNING_RUN_STATUSES.includes(run.status) && getDescendantActionIds(state, run.blockId).has(actionId));
  const log = {
    id: context.id("log"),
    actionId,
    actionNameSnapshot: action.name,
    directionSnapshot: action.direction,
    timestamp: input.timestamp || context.now,
    eventAt: input.timestamp || context.now,
    ...values,
    durationMinutes: values.durationPerformed || 0,
    quantity: values.quantityPerformed || 0,
    completionMethodSnapshot: action.completion.method,
    completionTargetSnapshot: action.completion.method === "time" ? Number(action.completion.minimumMinutes ?? action.completion.target ?? 0) : Number(action.completion.target || 1),
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
    createdAt: context.now
  };
  state.actionLogs.push(log);
  for (const occurrence of linkedOccurrences) {
    occurrence.actionLogIds = [...new Set([...(occurrence.actionLogIds || occurrence.logIds || []), log.id])];
    occurrence.logIds = [...occurrence.actionLogIds];
    occurrence.actual = Number(occurrence.actual || 0) + Number(values.completionContribution || 0);
    if (action.completion.method === "time") occurrence.durationMinutesActual = occurrence.actual;
    else occurrence.quantityActual = occurrence.actual;
    const completion = actionCompletion(action, occurrence.actual);
    occurrence.status = completion.complete ? "completed" : "partial";
    occurrence.completedAt = completion.complete ? context.now : null;
    occurrence.updatedAt = context.now;
  }
  for (const run of linkedRuns) {
    run.actionLogIds = [...new Set([...(run.actionLogIds || run.logIds || []), log.id])];
    run.logIds = [...run.actionLogIds];
  }
  state.history.push(historyEvent({ id: context.id("history"), type: "action_log", event: "action_logged", objectType: "action", objectId: action.id, nameSnapshot: action.name, description: `${action.name} logged`, timestamp: context.now, references: { actionLogId: log.id, linkedBlockIds: log.linkedBlockIds, linkedRunIds: log.linkedRunIds, linkedOccurrenceIds: log.linkedOccurrenceIds } }));
  return { value: log, events: [domainEvent(EVENTS.ACTION_LOGGED, { actionLogId: log.id, actionId, linkedBlockIds: log.linkedBlockIds }, context.now)] };
}

export function deleteActionLogCommand(state, logId, context) {
  const index = state.actionLogs.findIndex((item) => item.id === logId);
  if (index < 0) throw new NotFoundError(`Action Log not found: ${logId}`);
  const [log] = state.actionLogs.splice(index, 1);
  const action = state.actions.find((item) => item.id === log.actionId);
  for (const occurrence of state.occurrences || []) {
    const occurrenceLogIds = Array.from(new Set([...(occurrence.actionLogIds || []), ...(occurrence.logIds || [])]));
    if (!occurrenceLogIds.includes(logId)) continue;
    occurrence.actionLogIds = occurrenceLogIds.filter((id) => id !== logId);
    occurrence.logIds = [...occurrence.actionLogIds];
    const remaining = state.actionLogs.filter((item) => occurrence.actionLogIds.includes(item.id));
    occurrence.actual = remaining.reduce((total, item) => total + Number(action?.completion?.method === "time" ? (item.durationPerformed ?? item.durationMinutes ?? 0) : (item.quantityPerformed ?? item.quantity ?? 0)), 0);
    if (action?.completion?.method === "time") occurrence.durationMinutesActual = occurrence.actual;
    else occurrence.quantityActual = occurrence.actual;
    if (action && occurrence.status === "completed") {
      const completion = actionCompletion(action, occurrence.actual);
      occurrence.status = completion.complete ? "completed" : occurrence.dueAt && new Date(context.now) > new Date(occurrence.dueAt) ? (occurrence.expiryPolicy === "expire" ? "missed" : "overdue") : occurrence.actual > 0 ? "partial" : "available";
      occurrence.completedAt = completion.complete ? occurrence.completedAt : null;
    }
    occurrence.updatedAt = context.now;
  }
  for (const run of state.runs || []) {
    const ids = Array.from(new Set([...(run.actionLogIds || []), ...(run.logIds || [])]));
    if (!ids.includes(logId)) continue;
    run.actionLogIds = ids.filter((id) => id !== logId);
    run.logIds = [...run.actionLogIds];
    run.updatedAt = context.now;
  }
  state.history.push(historyEvent({ id: context.id("history"), type: "correction", event: "action_log_deleted", objectType: "action", objectId: log.actionId, nameSnapshot: log.actionNameSnapshot, description: "Action Log deleted", timestamp: context.now, references: { deletedActionLogSnapshot: deepClone(log) } }));
  return { value: log, events: [domainEvent(EVENTS.ACTION_LOG_DELETED, { actionLogId: logId }, context.now)] };
}

export function activateBlockCommand(state, blockId, config, context) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) throw new NotFoundError(`Block not found: ${blockId}`);
  assertOneActiveActivation(state.activations, blockId);
  const activation = { id: context.id("activation"), blockId, blockNameSnapshot: block.name, status: config.status || "manual", startAt: config.startAt || context.now, repeat: config.repeat || { mode: "none" }, deadline: config.deadline || null, note: config.note || "", cycleState: block.type === "cycle" ? { currentPosition: 0, currentRound: 1, completedRounds: 0 } : null, roundSnapshot: block.type === "cycle" ? distributeCycleFrequency(block.children) : null, createdAt: context.now, updatedAt: context.now };
  state.activations.push(activation);
  return { value: activation, events: [domainEvent(EVENTS.BLOCK_ACTIVATED, { activationId: activation.id, blockId }, context.now)] };
}

export function pauseBlockCommand(state, activationId, resumeAt, context) {
  const index = state.activations.findIndex((item) => item.id === activationId);
  if (index < 0) throw new NotFoundError(`Activation not found: ${activationId}`);
  state.activations[index] = pauseActivation(state.activations[index], context.now, resumeAt);
  return { value: state.activations[index], events: [domainEvent(EVENTS.BLOCK_PAUSED, { activationId }, context.now)] };
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
  assertNoRunningRun(state.runs, blockId);
  const activation = activationId ? state.activations.find((item) => item.id === activationId) : null;
  const run = createRun({ id: context.id("run"), block, activation, now: context.now, snapshot: snapshotBlock(state, blockId) });
  state.runs.push(run);
  return { value: run, events: [domainEvent(EVENTS.RUN_STARTED, { runId: run.id, blockId }, context.now)] };
}

export function finishRunCommand(state, runId, context) {
  const index = state.runs.findIndex((item) => item.id === runId);
  if (index < 0) throw new NotFoundError(`Run not found: ${runId}`);
  state.runs[index] = finishRun(state.runs[index], context.now);
  return { value: state.runs[index], events: [domainEvent(EVENTS.RUN_FINISHED, { runId, blockId: state.runs[index].blockId }, context.now)] };
}

export function completeOccurrenceCommand(state, occurrenceId, status, context) {
  const index = state.occurrences.findIndex((item) => item.id === occurrenceId);
  if (index < 0) throw new NotFoundError(`Occurrence not found: ${occurrenceId}`);
  state.occurrences[index] = completeOccurrenceDomain(state.occurrences[index], context.now, status || "completed");
  return { value: state.occurrences[index], events: [domainEvent(EVENTS.OCCURRENCE_COMPLETED, { occurrenceId, status: state.occurrences[index].status }, context.now)] };
}

export function advanceCycleCommand(state, activationId, context) {
  const activation = state.activations.find((item) => item.id === activationId);
  if (!activation) throw new NotFoundError(`Activation not found: ${activationId}`);
  const block = state.blocks.find((item) => item.id === activation.blockId);
  if (!block || block.type !== "cycle") throw new ValidationError("Activation does not belong to a Cycle.");
  const sequence = activation.roundSnapshot || distributeCycleFrequency(block.children);
  activation.cycleState = advanceCycleDomain(activation.cycleState || activation, sequence.length);
  activation.updatedAt = context.now;
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
      : evaluateAvoidPeriod({ state, block, now: context.now, timezone: context.timezone, bounds })
    : calculateTargetProgress({ state, block, now: context.now, timezone: context.timezone, bounds, closed: true });
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
  if (kind === "action") for (const block of state.blocks) block.children = (block.children || []).filter((child) => !(child.kind === "action" && child.refId === id));
  else for (const block of state.blocks) block.children = (block.children || []).filter((child) => !(child.kind === "block" && child.refId === id));
  const binItem = { id: context.id("bin"), objectType: kind, objectId: id, nameSnapshot: snapshot.name, snapshot, deletedAt: context.now, purgeAt: new Date(new Date(context.now).getTime() + 10 * 86400000).toISOString() };
  state.bin.push(binItem);
  return { value: binItem, events: [] };
}

export function commandContext(now, idFactory = createId, timezone = "Europe/London") { return { now, timezone, id: (prefix) => idFactory(prefix) }; }
