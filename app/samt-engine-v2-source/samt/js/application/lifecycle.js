import { calculatePeriodBounds, calendarDateKey, nextPeriodBounds } from "../shared/dates.js";
import { stableTemporalId } from "../shared/ids.js";
import { closePeriodRecord, openPeriodRecord } from "../domain/periods.js";
import { calculateTargetProgress, normalizeTargetConfig } from "../domain/targets.js";
import { evaluateAvoidActionPeriod, evaluateAvoidPeriod, normalizeAvoidEvaluation, validateAvoidEvaluation } from "../domain/avoid.js";
import { normalizeSchedule, occurrenceWindowForDate, scheduleAppliesOnDate } from "../domain/scheduling.js";
import { resolveOccurrenceStatus } from "../domain/occurrences.js";
import { getDescendantActionIds } from "../domain/relationships.js";
import { applyCyclePeriodEnd, applyMissedCycleItemPolicy, distributeCycleFrequency, getCurrentCyclePosition } from "../domain/cycles.js";
import { ACTIVE_ACTIVATION_STATUSES, resumeActivation } from "../domain/activations.js";
import { resumeRun } from "../domain/runs.js";
import { EVENTS, domainEvent } from "./events.js";

const MAX_CATCH_UP_WINDOWS = 10000;
const CLOSED_OCCURRENCE_STATES = new Set(["completed", "skipped", "missed"]);

function historyExists(state, id) { return (state.history || []).some((item) => item.id === id); }
function periodIsOpen(record) { return !record.closedAt && record.lifecycleStatus !== "closed" && !["completed", "closed", "cancelled"].includes(record.lifecycleStatus); }
function samePeriod(record, ownerMatch, bounds) { return ownerMatch(record) && record.periodStart === bounds.start && (record.periodEnd || null) === (bounds.end || null); }
function beforeOrEqual(left, right) { return Date.parse(left) <= Date.parse(right); }

function addPeriodHistory(state, record, event, now) {
  const id = `history_${record.id}_closed`;
  if (historyExists(state, id)) return;
  state.history.push({
    id,
    type: "period",
    event,
    objectType: record.actionId ? "action" : "block",
    objectId: record.actionId || record.blockId,
    nameSnapshot: record.actionNameSnapshot || record.blockNameSnapshot,
    timestamp: record.periodEnd || now,
    recordedAt: now,
    createdAt: now,
    periodId: record.id,
    actual: record.actual,
    score: record.score ?? null,
    status: record.status,
    actionLogIds: record.actionLogIds || [],
    contextBlockId: record.contextBlockId || null,
    relationshipId: record.relationshipId || null
  });
}

function reconcileScheduledResumes(state, now, events) {
  for (const activation of state.activations || []) {
    if (activation.status !== "paused" || !activation.resumeAt || Date.parse(activation.resumeAt) > Date.parse(now)) continue;
    Object.assign(activation, resumeActivation(activation, now));
    const historyId = `history_${activation.id}_resumed_${String(now).replace(/[^0-9A-Za-z]/g, "")}`;
    if (!historyExists(state, historyId)) state.history.push({ id: historyId, type: "activation", event: "block_resumed", objectType: "block", objectId: activation.blockId, nameSnapshot: activation.blockNameSnapshot, timestamp: now, createdAt: now, activationId: activation.id, automatic: true });
    events.push(domainEvent(EVENTS.BLOCK_RESUMED, { activationId: activation.id, blockId: activation.blockId, automatic: true }, now));
  }
  for (const run of state.runs || []) {
    if (run.status !== "paused" || !run.resumeAt || Date.parse(run.resumeAt) > Date.parse(now)) continue;
    Object.assign(run, resumeRun(run, now));
    const historyId = `history_${run.id}_resumed_${String(now).replace(/[^0-9A-Za-z]/g, "")}`;
    if (!historyExists(state, historyId)) state.history.push({ id: historyId, type: "run", event: "run_resumed", objectType: "block", objectId: run.blockId, nameSnapshot: run.blockNameSnapshot, timestamp: now, createdAt: now, runId: run.id, automatic: true });
    events.push(domainEvent(EVENTS.RUN_RESUMED, { runId: run.id, blockId: run.blockId, automatic: true }, now));
  }
}

function reconcilePeriodSeries({ collection, ownerMatch, period, currentBounds, timezone, autoClose, createRecord, closeRecord }) {
  const records = () => collection.filter(ownerMatch).sort((a, b) => Date.parse(a.periodStart) - Date.parse(b.periodStart));
  for (const record of records().filter((item) => periodIsOpen(item) && item.periodEnd && beforeOrEqual(item.periodEnd, currentBounds.start))) {
    if (!autoClose) return;
    closeRecord(record);
  }
  const relevant = records();
  if (!relevant.length) {
    createRecord(currentBounds);
    return;
  }
  const latest = relevant[relevant.length - 1];
  let cursor = { start: latest.periodStart, end: latest.periodEnd, mode: currentBounds.mode };
  if (!cursor.end || Date.parse(cursor.start) >= Date.parse(currentBounds.start)) return;
  for (let index = 0; index < MAX_CATCH_UP_WINDOWS && Date.parse(cursor.start) < Date.parse(currentBounds.start); index += 1) {
    const next = nextPeriodBounds(period, cursor, timezone);
    if (!next || Date.parse(next.start) > Date.parse(currentBounds.start)) break;
    let record = collection.find((item) => samePeriod(item, ownerMatch, next));
    if (!record) record = createRecord(next);
    if (Date.parse(next.start) < Date.parse(currentBounds.start)) {
      if (!autoClose) return;
      if (periodIsOpen(record)) closeRecord(record);
    }
    cursor = next;
    if (next.start === currentBounds.start) return;
  }
  if (!collection.some((item) => samePeriod(item, ownerMatch, currentBounds))) createRecord(currentBounds);
}

function targetAutoClose(state, block) {
  return block.typeConfig?.periodEnd?.autoClose ?? block.typeConfig?.autoClose ?? state.settings?.behaviourDefaults?.targets?.autoClose ?? true;
}

function createTargetPeriod(state, block, config, bounds, now) {
  const id = stableTemporalId("target_period", block.id, bounds.start);
  const record = openPeriodRecord({ id, block, bounds, targetSnapshot: config, now, kind: "target" });
  record.actionIdsSnapshot = [...getDescendantActionIds(state, block.id)];
  state.targetPeriods.push(record);
  return record;
}

function closeTargetPeriod(state, block, record, now, timezone, events) {
  const config = record.targetSnapshot?.targetMetric ? record.targetSnapshot : normalizeTargetConfig(block);
  const evaluation = calculateTargetProgress({
    state,
    block,
    now: record.periodEnd,
    timezone,
    bounds: { start: record.periodStart, end: record.periodEnd },
    closed: true,
    config,
    actionIds: record.actionIdsSnapshot || null
  });
  Object.assign(record, closePeriodRecord(record, evaluation, now));
  addPeriodHistory(state, record, "target_period_closed", now);
  events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, blockId: block.id, status: record.status }, now));
  if (evaluation.reached) events.push(domainEvent(EVENTS.TARGET_REACHED, { periodId: record.id, blockId: block.id }, now));
}

function reconcileTargetPeriods(state, now, timezone, events) {
  for (const block of state.blocks.filter((item) => item.type === "target" && item.status === "active" && item.direction !== "avoid")) {
    const config = normalizeTargetConfig(block);
    if (["session", "all_time"].includes(config.period.mode || config.period)) continue;
    const currentBounds = calculatePeriodBounds(config.period, now, timezone);
    reconcilePeriodSeries({
      collection: state.targetPeriods,
      ownerMatch: (record) => record.blockId === block.id,
      period: config.period,
      currentBounds,
      timezone,
      autoClose: targetAutoClose(state, block),
      createRecord: (bounds) => createTargetPeriod(state, block, config, bounds, now),
      closeRecord: (record) => closeTargetPeriod(state, block, record, now, timezone, events)
    });
  }
}

function avoidAutoClose(block) { return block.typeConfig?.periodEnd?.autoClose ?? block.typeConfig?.autoClose ?? true; }

function createAvoidPeriod(state, block, config, bounds, now) {
  const id = stableTemporalId("avoid_period", block.id, bounds.start);
  const record = openPeriodRecord({ id, block, bounds, targetSnapshot: config, now, kind: "avoid" });
  record.evaluationSnapshot = config;
  record.actionIdsSnapshot = [...getDescendantActionIds(state, block.id)];
  state.avoidPeriods.push(record);
  return record;
}

function closeAvoidPeriod(state, block, record, now, timezone, events) {
  const config = record.evaluationSnapshot || validateAvoidEvaluation(block.typeConfig?.avoidEvaluation || {});
  const evaluation = evaluateAvoidPeriod({ state, block, now: record.periodEnd, timezone, bounds: { start: record.periodStart, end: record.periodEnd }, config, actionIds: record.actionIdsSnapshot || null });
  Object.assign(record, closePeriodRecord(record, evaluation, now));
  addPeriodHistory(state, record, "avoid_period_closed", now);
  events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, blockId: block.id, status: record.status }, now));
  if (evaluation.status === "failed") events.push(domainEvent(EVENTS.AVOID_FAILED, { periodId: record.id, blockId: block.id }, now));
}

function reconcileAvoidPeriods(state, now, timezone, events) {
  for (const block of state.blocks.filter((item) => item.status === "active" && item.direction === "avoid")) {
    const config = validateAvoidEvaluation(block.typeConfig?.avoidEvaluation || {});
    if (["session", "all_time"].includes(config.period.mode || config.period)) continue;
    const currentBounds = calculatePeriodBounds(config.period, now, timezone);
    reconcilePeriodSeries({
      collection: state.avoidPeriods,
      ownerMatch: (record) => record.blockId === block.id && !record.relationshipId,
      period: config.period,
      currentBounds,
      timezone,
      autoClose: avoidAutoClose(block),
      createRecord: (bounds) => createAvoidPeriod(state, block, config, bounds, now),
      closeRecord: (record) => closeAvoidPeriod(state, block, record, now, timezone, events)
    });
  }
}

function directAvoidConfig(block, relationship, action) {
  return validateAvoidEvaluation(normalizeAvoidEvaluation(relationship.avoidEvaluation || block.typeConfig?.avoidEvaluation || {
    mode: "binary_limit",
    metric: action.avoidMetricHint || (action.completion?.method === "time" ? "time" : "count"),
    binaryLimit: 0,
    period: { mode: "day" }
  }));
}

function createDirectAvoidPeriod(state, block, relationship, action, config, bounds, now) {
  const id = stableTemporalId("avoid_period", relationship.id, bounds.start);
  const record = {
    id,
    kind: "avoid",
    blockId: block.id,
    contextBlockId: block.id,
    blockNameSnapshot: block.name,
    relationshipId: relationship.id,
    actionId: action.id,
    actionNameSnapshot: action.name,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    evaluationSnapshot: config,
    actual: 0,
    status: "open",
    lifecycleStatus: "open",
    actionLogIds: [],
    createdAt: now,
    updatedAt: now
  };
  state.avoidPeriods.push(record);
  return record;
}

function closeDirectAvoidPeriod(state, block, relationship, action, record, now, timezone, events) {
  const evaluation = evaluateAvoidActionPeriod({ logs: state.actionLogs, actionId: action.id, evaluation: record.evaluationSnapshot, now: record.periodEnd, timezone, bounds: { start: record.periodStart, end: record.periodEnd } });
  Object.assign(record, closePeriodRecord(record, evaluation, now));
  addPeriodHistory(state, record, "avoid_period_closed", now);
  events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, actionId: action.id, blockId: block.id, status: record.status }, now));
  if (evaluation.status === "failed") events.push(domainEvent(EVENTS.AVOID_FAILED, { periodId: record.id, actionId: action.id, blockId: block.id }, now));
}

function reconcileDirectAvoidPeriods(state, now, timezone, events) {
  for (const block of state.blocks.filter((item) => item.type === "action_list" && item.status === "active")) {
    for (const relationship of block.children || []) {
      if (relationship.kind !== "action") continue;
      const action = state.actions.find((item) => item.id === relationship.refId);
      if (!action || action.direction !== "avoid") continue;
      const config = directAvoidConfig(block, relationship, action);
      if (["session", "all_time"].includes(config.period.mode || config.period)) continue;
      const currentBounds = calculatePeriodBounds(config.period, now, timezone);
      reconcilePeriodSeries({
        collection: state.avoidPeriods,
        ownerMatch: (record) => record.relationshipId === relationship.id || (record.actionId === action.id && record.contextBlockId === block.id),
        period: config.period,
        currentBounds,
        timezone,
        autoClose: relationship.periodEnd?.autoClose ?? true,
        createRecord: (bounds) => createDirectAvoidPeriod(state, block, relationship, action, config, bounds, now),
        closeRecord: (record) => closeDirectAvoidPeriod(state, block, relationship, action, record, now, timezone, events)
      });
    }
  }
}

function cyclePolicies(state, block) {
  const defaults = state.settings?.behaviourDefaults?.cycles || {};
  return {
    autoClose: block.typeConfig?.periodEnd?.autoClose ?? block.typeConfig?.autoClose ?? defaults.autoClose ?? true,
    position: block.typeConfig?.positionPolicy || block.typeConfig?.position || defaults.position || "continue",
    missedItem: block.typeConfig?.missedItemPolicy || block.typeConfig?.missedItem || defaults.missedItem || "keep"
  };
}

function createCyclePeriod(state, block, activation, sequence, bounds, policies, now) {
  const position = getCurrentCyclePosition(activation.cycleState || activation, sequence.length);
  const item = sequence[position] || null;
  const record = {
    id: stableTemporalId("cycle_period", activation.id, bounds.start),
    kind: "cycle",
    blockId: block.id,
    blockNameSnapshot: block.name,
    activationId: activation.id,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    positionAtStart: position,
    relationshipId: item?.sourceRelationshipId || item?.id || null,
    itemSnapshot: item ? { ...item } : null,
    policySnapshot: { ...policies },
    itemCompleted: false,
    status: "open",
    lifecycleStatus: "open",
    actionLogIds: [],
    createdAt: now,
    updatedAt: now
  };
  state.cyclePeriods.push(record);
  return record;
}

function closeCyclePeriod(state, block, activation, sequence, record, now, events) {
  const policy = record.policySnapshot || cyclePolicies(state, block);
  const previous = getCurrentCyclePosition(activation.cycleState || activation, sequence.length);
  if (!record.itemCompleted) activation.cycleState = applyMissedCycleItemPolicy(activation.cycleState || activation, sequence.length, policy.missedItem);
  activation.cycleState = applyCyclePeriodEnd(activation.cycleState || activation, { position: policy.position });
  activation.updatedAt = now;
  record.status = record.itemCompleted ? "completed" : "missed";
  record.lifecycleStatus = "closed";
  record.positionAtEnd = getCurrentCyclePosition(activation.cycleState || activation, sequence.length);
  record.closedAt = now;
  record.updatedAt = now;
  addPeriodHistory(state, record, "cycle_period_closed", now);
  events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, blockId: block.id, status: record.status }, now));
  if (record.positionAtEnd !== previous) events.push(domainEvent(EVENTS.CYCLE_ADVANCED, { activationId: activation.id, blockId: block.id, position: record.positionAtEnd, reason: "period_end" }, now));
}

function reconcileCyclePeriods(state, now, timezone, events) {
  for (const block of state.blocks.filter((item) => item.type === "cycle" && item.status === "active")) {
    const period = block.typeConfig?.period;
    if (!period || ["session", "all_time", "all"].includes(period.mode || period)) continue;
    const activation = state.activations.find((item) => item.blockId === block.id && ACTIVE_ACTIVATION_STATUSES.includes(item.status) && item.status !== "paused");
    if (!activation) continue;
    const sequence = activation.roundSnapshot || distributeCycleFrequency(block.children || []);
    const policies = cyclePolicies(state, block);
    const currentBounds = calculatePeriodBounds(period, now, timezone);
    reconcilePeriodSeries({
      collection: state.cyclePeriods,
      ownerMatch: (record) => record.activationId === activation.id,
      period,
      currentBounds,
      timezone,
      autoClose: policies.autoClose,
      createRecord: (bounds) => createCyclePeriod(state, block, activation, sequence, bounds, policies, now),
      closeRecord: (record) => closeCyclePeriod(state, block, activation, sequence, record, now, events)
    });
  }
}

function relationshipSchedule(state, block, relationship) {
  if (relationship.schedule) {
    const schedule = relationship.schedule;
    const hasExplicitExpiry = schedule.expiryPolicy != null || schedule.carryPolicy != null || schedule.unfinishedPolicy != null;
    if (hasExplicitExpiry) return schedule;
    const expireByDefault = block.type === "routine"
      ? state.settings?.behaviourDefaults?.routines?.expireUnfinishedOccurrence ?? true
      : state.settings?.behaviourDefaults?.actionLists?.expireConfiguredOccurrences ?? true;
    return { ...schedule, expiryPolicy: expireByDefault ? "expire" : "carry_forward" };
  }
  if (block.typeConfig?.suggestedRecurrence === "daily") return { mode: "daily", expiryPolicy: "expire" };
  if (block.typeConfig?.suggestedWeekday != null) return { mode: "weekdays", weekdays: [Number(block.typeConfig.suggestedWeekday)], expiryPolicy: "expire" };
  return null;
}

function addOccurrenceMissHistory(state, occurrence, now, events) {
  const historyId = `history_${occurrence.id}_missed`;
  if (!historyExists(state, historyId)) state.history.push({ id: historyId, type: "occurrence", event: "occurrence_missed", objectType: "action", objectId: occurrence.actionId, nameSnapshot: occurrence.actionNameSnapshot, timestamp: occurrence.dueAt || now, recordedAt: now, createdAt: now, occurrenceId: occurrence.id });
  events.push(domainEvent(EVENTS.OCCURRENCE_MISSED, { occurrenceId: occurrence.id }, now));
}

function reconcileExistingOccurrenceStatuses(state, now, events) {
  for (const occurrence of state.occurrences) {
    const resolved = resolveOccurrenceStatus(occurrence, now);
    if (resolved === occurrence.status) continue;
    occurrence.status = resolved;
    occurrence.updatedAt = now;
    if (resolved === "missed") addOccurrenceMissHistory(state, occurrence, now, events);
  }
}

function occurrenceIdFor(relationship, schedule, instant, timezone) {
  if (["always", "once"].includes(schedule.mode)) return `occurrence_${relationship.id}_${schedule.mode}`;
  if (schedule.mode === "interval") return `occurrence_${relationship.id}_${String(instant).replace(/[^0-9A-Za-z]/g, "")}`;
  return `occurrence_${relationship.id}_${calendarDateKey(instant, timezone).replace(/-/g, "")}`;
}

function createOccurrence(state, block, relationship, action, schedule, instant, now, timezone, events) {
  const id = occurrenceIdFor(relationship, schedule, instant, timezone);
  if (state.occurrences.some((item) => item.id === id)) return null;
  const occurrenceWindow = occurrenceWindowForDate(schedule, instant, timezone);
  const occurrence = {
    id,
    actionId: action.id,
    actionNameSnapshot: action.name,
    directionSnapshot: action.direction,
    parentBlockId: block.id,
    blockNameSnapshot: block.name,
    relationshipId: relationship.id,
    relationshipSnapshot: { ...relationship },
    completionSnapshot: { ...action.completion },
    scheduleSnapshot: { ...schedule },
    availableAt: occurrenceWindow.availableAt,
    dueAt: occurrenceWindow.dueAt,
    expiryPolicy: occurrenceWindow.expiryPolicy,
    actual: 0,
    status: resolveOccurrenceStatus({ availableAt: occurrenceWindow.availableAt, dueAt: occurrenceWindow.dueAt, expiryPolicy: occurrenceWindow.expiryPolicy, status: "upcoming" }, now),
    actionLogIds: [],
    createdAt: now,
    updatedAt: now
  };
  state.occurrences.push(occurrence);
  events.push(domainEvent(EVENTS.OCCURRENCE_CREATED, { occurrenceId: id, actionId: action.id, blockId: block.id }, now));
  if (occurrence.status === "missed") addOccurrenceMissHistory(state, occurrence, now, events);
  return occurrence;
}

function dailyInstantsToReconcile(state, relationship, now, timezone, previousReconciledAt) {
  const existing = state.occurrences.filter((item) => item.relationshipId === relationship.id && item.availableAt).sort((a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt));
  const startingInstant = existing[0]?.availableAt || previousReconciledAt || now;
  let cursor = calculatePeriodBounds({ mode: "day" }, startingInstant, timezone);
  const current = calculatePeriodBounds({ mode: "day" }, now, timezone);
  const output = [];
  if (!existing.length && cursor.start === current.start) return [now];
  if (existing.length) cursor = nextPeriodBounds({ mode: "day" }, cursor, timezone);
  for (let index = 0; index < MAX_CATCH_UP_WINDOWS && cursor && Date.parse(cursor.start) <= Date.parse(current.start); index += 1) {
    output.push(cursor.start);
    if (cursor.start === current.start) break;
    cursor = nextPeriodBounds({ mode: "day" }, cursor, timezone);
  }
  return output;
}

function reconcileIntervalOccurrence(state, block, relationship, action, schedule, now, timezone, events) {
  const occurrences = state.occurrences.filter((item) => item.relationshipId === relationship.id).sort((a, b) => Date.parse(b.availableAt || b.createdAt) - Date.parse(a.availableAt || a.createdAt));
  if (occurrences.some((item) => !CLOSED_OCCURRENCE_STATES.has(item.status))) return;
  const last = occurrences[0];
  const instant = last ? new Date(Date.parse(last.completedAt || last.dueAt || last.availableAt) + schedule.intervalMinutes * 60000).toISOString() : (schedule.availableAt || now);
  createOccurrence(state, block, relationship, action, schedule, instant, now, timezone, events);
}

function reconcileOccurrences(state, now, timezone, events, previousReconciledAt) {
  reconcileExistingOccurrenceStatuses(state, now, events);
  for (const block of state.blocks.filter((item) => item.status === "active" && ["action_list", "routine"].includes(item.type))) {
    for (const relationship of block.children || []) {
      if (relationship.kind !== "action") continue;
      const rawSchedule = relationshipSchedule(state, block, relationship);
      if (!rawSchedule) continue;
      const schedule = normalizeSchedule(rawSchedule);
      const action = state.actions.find((item) => item.id === relationship.refId);
      if (!action || action.direction === "avoid") continue;
      if (schedule.mode === "interval") {
        reconcileIntervalOccurrence(state, block, relationship, action, schedule, now, timezone, events);
        continue;
      }
      if (["always", "once"].includes(schedule.mode)) {
        const instant = schedule.availableAt || now;
        if (scheduleAppliesOnDate(schedule, instant, timezone)) createOccurrence(state, block, relationship, action, schedule, instant, now, timezone, events);
        continue;
      }
      for (const instant of dailyInstantsToReconcile(state, relationship, now, timezone, previousReconciledAt)) {
        if (scheduleAppliesOnDate(schedule, instant, timezone)) createOccurrence(state, block, relationship, action, schedule, instant, now, timezone, events);
      }
    }
  }
}

export function reconcileTemporalState(state, { now, timezone }) {
  const events = [];
  state.targetPeriods = Array.isArray(state.targetPeriods) ? state.targetPeriods : [];
  state.avoidPeriods = Array.isArray(state.avoidPeriods) ? state.avoidPeriods : [];
  state.cyclePeriods = Array.isArray(state.cyclePeriods) ? state.cyclePeriods : [];
  state.occurrences = Array.isArray(state.occurrences) ? state.occurrences : [];
  state.history = Array.isArray(state.history) ? state.history : [];
  state.meta = state.meta || {};
  const previousReconciledAt = state.meta.lastTemporalReconciliationAt || now;
  reconcileScheduledResumes(state, now, events);
  reconcileTargetPeriods(state, now, timezone, events);
  reconcileAvoidPeriods(state, now, timezone, events);
  reconcileDirectAvoidPeriods(state, now, timezone, events);
  reconcileCyclePeriods(state, now, timezone, events);
  reconcileOccurrences(state, now, timezone, events, previousReconciledAt);
  state.meta.lastTemporalReconciliationAt = now;
  return { state, events };
}
