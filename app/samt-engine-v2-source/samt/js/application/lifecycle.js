import { calculatePeriodBounds, calendarDateKey } from "../shared/dates.js";
import { stableTemporalId } from "../shared/ids.js";
import { closePeriodRecord, openPeriodRecord } from "../domain/periods.js";
import { calculateTargetProgress, normalizeTargetConfig } from "../domain/targets.js";
import { evaluateAvoidActionPeriod, evaluateAvoidPeriod, normalizeAvoidEvaluation, validateAvoidEvaluation } from "../domain/avoid.js";
import { normalizeSchedule, occurrenceWindowForDate, scheduleAppliesOnDate } from "../domain/scheduling.js";
import { resolveOccurrenceStatus } from "../domain/occurrences.js";
import { EVENTS, domainEvent } from "./events.js";

function historyExists(state, id) { return (state.history || []).some((item) => item.id === id); }
function samePeriod(record, blockId, bounds) {
  return record.blockId === blockId && record.periodStart === bounds.start && (record.periodEnd || null) === (bounds.end || null);
}
function periodIsOpen(record) { return !record.closedAt && !["completed", "closed", "period_success", "period_failure"].includes(record.lifecycleStatus); }

function addPeriodHistory(state, record, event, now) {
  const id = `history_${record.id}_closed`;
  if (historyExists(state, id)) return;
  state.history.push({ id, type: "period", event, objectType: record.actionId ? "action" : "block", objectId: record.actionId || record.blockId, nameSnapshot: record.actionNameSnapshot || record.blockNameSnapshot, timestamp: now, createdAt: now, periodId: record.id, actual: record.actual, score: record.score ?? null, status: record.status, actionLogIds: record.actionLogIds || [], contextBlockId: record.contextBlockId || null, relationshipId: record.relationshipId || null });
}

function reconcileTargetPeriods(state, now, timezone, events) {
  for (const block of (state.blocks || []).filter((item) => item.type === "target" && item.status === "active" && item.direction !== "avoid")) {
    const config = normalizeTargetConfig(block);
    if (["session", "all_time"].includes(config.period.mode || config.period)) continue;
    const currentBounds = calculatePeriodBounds(config.period, now, timezone);
    const records = state.targetPeriods.filter((item) => item.blockId === block.id);
    for (const record of records.filter((item) => periodIsOpen(item) && item.periodEnd && new Date(item.periodEnd).getTime() <= new Date(now).getTime())) {
      const evaluation = calculateTargetProgress({ state, block, now: record.periodEnd, timezone, bounds: { start: record.periodStart, end: record.periodEnd }, closed: true });
      Object.assign(record, closePeriodRecord(record, evaluation, now));
      addPeriodHistory(state, record, "target_period_closed", now);
      events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, blockId: block.id, status: record.status }, now));
      if (evaluation.reached) events.push(domainEvent(EVENTS.TARGET_REACHED, { periodId: record.id, blockId: block.id }, now));
    }
    const id = stableTemporalId("target_period", block.id, currentBounds.start);
    if (!state.targetPeriods.some((item) => item.id === id || samePeriod(item, block.id, currentBounds))) {
      state.targetPeriods.push(openPeriodRecord({ id, block, bounds: currentBounds, targetSnapshot: { metric: config.targetMetric, value: config.targetValue, unit: config.targetUnit }, now, kind: "target" }));
    }
  }
}

function reconcileAvoidPeriods(state, now, timezone, events) {
  for (const block of (state.blocks || []).filter((item) => item.status === "active" && item.direction === "avoid")) {
    const config = validateAvoidEvaluation(block.typeConfig?.avoidEvaluation || {});
    if (["session", "all_time"].includes(config.period.mode || config.period)) continue;
    const currentBounds = calculatePeriodBounds(config.period, now, timezone);
    const records = state.avoidPeriods.filter((item) => item.blockId === block.id);
    for (const record of records.filter((item) => periodIsOpen(item) && item.periodEnd && new Date(item.periodEnd).getTime() <= new Date(now).getTime())) {
      const evaluation = evaluateAvoidPeriod({ state, block, now: record.periodEnd, timezone, bounds: { start: record.periodStart, end: record.periodEnd } });
      Object.assign(record, closePeriodRecord(record, evaluation, now));
      addPeriodHistory(state, record, "avoid_period_closed", now);
      events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, blockId: block.id, status: record.status }, now));
      if (evaluation.status === "failed") events.push(domainEvent(EVENTS.AVOID_FAILED, { periodId: record.id, blockId: block.id }, now));
    }
    const id = stableTemporalId("avoid_period", block.id, currentBounds.start);
    if (!state.avoidPeriods.some((item) => item.id === id || samePeriod(item, block.id, currentBounds))) {
      state.avoidPeriods.push(openPeriodRecord({ id, block, bounds: currentBounds, targetSnapshot: config, now, kind: "avoid" }));
    }
  }
}

function reconcileDirectAvoidPeriods(state, now, timezone, events) {
  for (const block of (state.blocks || []).filter((item) => item.type === "action_list" && item.status === "active")) {
    for (const relationship of block.children || []) {
      if (relationship.kind !== "action") continue;
      const action = state.actions.find((item) => item.id === relationship.refId);
      if (!action || action.direction !== "avoid") continue;
      const config = normalizeAvoidEvaluation(relationship.avoidEvaluation || block.typeConfig?.avoidEvaluation || { mode: "binary_limit", metric: action.avoidMetricHint || (action.completion?.method === "time" ? "time" : "count"), binaryLimit: 0, period: { mode: "day" } });
      validateAvoidEvaluation(config);
      if (["session", "all_time"].includes(config.period.mode || config.period)) continue;
      const currentBounds = calculatePeriodBounds(config.period, now, timezone);
      const records = state.avoidPeriods.filter((item) => item.relationshipId === relationship.id || (item.actionId === action.id && item.contextBlockId === block.id));
      for (const record of records.filter((item) => periodIsOpen(item) && item.periodEnd && new Date(item.periodEnd).getTime() <= new Date(now).getTime())) {
        const evaluation = evaluateAvoidActionPeriod({ logs: state.actionLogs, actionId: action.id, evaluation: record.evaluationSnapshot || config, now: record.periodEnd, timezone, bounds: { start: record.periodStart, end: record.periodEnd } });
        Object.assign(record, closePeriodRecord(record, evaluation, now));
        addPeriodHistory(state, record, "avoid_period_closed", now);
        events.push(domainEvent(EVENTS.PERIOD_CLOSED, { periodId: record.id, actionId: action.id, blockId: block.id, status: record.status }, now));
        if (evaluation.status === "failed") events.push(domainEvent(EVENTS.AVOID_FAILED, { periodId: record.id, actionId: action.id, blockId: block.id }, now));
      }
      const id = stableTemporalId("avoid_period", relationship.id, currentBounds.start);
      if (!state.avoidPeriods.some((item) => item.id === id || (item.relationshipId === relationship.id && item.periodStart === currentBounds.start && (item.periodEnd || null) === (currentBounds.end || null)))) {
        state.avoidPeriods.push({ id, kind: "avoid", blockId: block.id, contextBlockId: block.id, blockNameSnapshot: block.name, relationshipId: relationship.id, actionId: action.id, actionNameSnapshot: action.name, periodStart: currentBounds.start, periodEnd: currentBounds.end, evaluationSnapshot: config, actual: 0, status: "open", actionLogIds: [], createdAt: now, updatedAt: now });
      }
    }
  }
}

function relationshipSchedule(block, relationship) {
  if (relationship.schedule) return relationship.schedule;
  if (block.typeConfig?.suggestedRecurrence === "daily") return { mode: "daily", expiryPolicy: "expire" };
  if (block.typeConfig?.suggestedWeekday != null) return { mode: "weekdays", weekdays: [Number(block.typeConfig.suggestedWeekday)], expiryPolicy: "expire" };
  return null;
}

function reconcileOccurrences(state, now, timezone, events) {
  for (const occurrence of state.occurrences) {
    const resolved = resolveOccurrenceStatus(occurrence, now);
    if (resolved !== occurrence.status) {
      occurrence.status = resolved;
      occurrence.updatedAt = now;
      if (resolved === "missed") {
        const historyId = `history_${occurrence.id}_missed`;
        if (!historyExists(state, historyId)) state.history.push({ id: historyId, type: "occurrence", event: "occurrence_missed", objectType: "action", objectId: occurrence.actionId, nameSnapshot: occurrence.actionNameSnapshot, timestamp: now, createdAt: now, occurrenceId: occurrence.id });
        events.push(domainEvent(EVENTS.OCCURRENCE_MISSED, { occurrenceId: occurrence.id }, now));
      }
    }
  }
  for (const block of (state.blocks || []).filter((item) => item.status === "active" && ["action_list", "routine"].includes(item.type))) {
    for (const relationship of block.children || []) {
      if (relationship.kind !== "action") continue;
      const schedule = relationshipSchedule(block, relationship);
      if (!schedule) continue;
      const normalizedSchedule = normalizeSchedule(schedule);
      let occurrenceInstant = now;
      const relationshipOccurrences = state.occurrences.filter((item) => item.relationshipId === relationship.id).sort((a, b) => new Date(b.availableAt || b.createdAt) - new Date(a.availableAt || a.createdAt));
      if (normalizedSchedule.mode === "interval") {
        if (relationshipOccurrences.some((item) => !["completed", "skipped", "missed"].includes(item.status))) continue;
        const last = relationshipOccurrences[0];
        occurrenceInstant = last ? new Date(new Date(last.completedAt || last.dueAt || last.deadlineAt || last.availableAt).getTime() + normalizedSchedule.intervalMinutes * 60000).toISOString() : (normalizedSchedule.availableAt || now);
      }
      if (!scheduleAppliesOnDate(normalizedSchedule, occurrenceInstant, timezone)) continue;
      const occurrenceDateKey = calendarDateKey(occurrenceInstant, timezone);
      const identitySuffix = ["always", "once"].includes(normalizedSchedule.mode) ? normalizedSchedule.mode : normalizedSchedule.mode === "interval" ? String(occurrenceInstant).replace(/[^0-9A-Za-z]/g, "") : occurrenceDateKey.replace(/-/g, "");
      const id = `occurrence_${relationship.id}_${identitySuffix}`;
      const existingForWindow = state.occurrences.some((item) => item.id === id || (["always", "once"].includes(normalizedSchedule.mode)
        ? item.relationshipId === relationship.id
        : item.relationshipId === relationship.id && item.availableAt && calendarDateKey(item.availableAt, timezone) === occurrenceDateKey));
      if (existingForWindow) continue;
      const action = state.actions.find((item) => item.id === relationship.refId);
      if (!action || action.direction === "avoid") continue;
      const occurrenceWindow = occurrenceWindowForDate(normalizedSchedule, occurrenceInstant, timezone);
      state.occurrences.push({ id, actionId: action.id, actionNameSnapshot: action.name, parentBlockId: block.id, blockNameSnapshot: block.name, relationshipId: relationship.id, availableAt: occurrenceWindow.availableAt, dueAt: occurrenceWindow.dueAt, expiryPolicy: occurrenceWindow.expiryPolicy, actual: 0, status: resolveOccurrenceStatus({ availableAt: occurrenceWindow.availableAt, dueAt: occurrenceWindow.dueAt, expiryPolicy: occurrenceWindow.expiryPolicy, status: "upcoming" }, now), actionLogIds: [], createdAt: now, updatedAt: now });
      events.push(domainEvent(EVENTS.OCCURRENCE_CREATED, { occurrenceId: id, actionId: action.id, blockId: block.id }, now));
    }
  }
}

export function reconcileTemporalState(state, { now, timezone }) {
  const events = [];
  state.targetPeriods = Array.isArray(state.targetPeriods) ? state.targetPeriods : [];
  state.avoidPeriods = Array.isArray(state.avoidPeriods) ? state.avoidPeriods : [];
  state.occurrences = Array.isArray(state.occurrences) ? state.occurrences : [];
  state.history = Array.isArray(state.history) ? state.history : [];
  reconcileTargetPeriods(state, now, timezone, events);
  reconcileAvoidPeriods(state, now, timezone, events);
  reconcileDirectAvoidPeriods(state, now, timezone, events);
  reconcileOccurrences(state, now, timezone, events);
  return { state, events };
}
