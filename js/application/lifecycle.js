import { calculatePeriodBounds, addCalendarDays, partsInTimeZone } from "../shared/dates.js";
import { createPeriod } from "../domain/periods.js";
import { createOccurrence, resolveOccurrenceStatus } from "../domain/occurrences.js";
import { occurrenceIdentity, isScheduleDue } from "../domain/scheduling.js";
import { evaluatePeriod } from "../domain/evaluation.js";
import { appendHistory } from "../domain/history.js";
import { shouldGenerateScheduledOccurrence, validateActionListSchedule } from "../domain/action-lists.js";
import { clone } from "../shared/validation.js";
import { createRun, startRun as startDomainRun, isRunTerminal } from "../domain/runs.js";
import { createActivation, isActivationEnded, recordActivationRun } from "../domain/activations.js";
import { initializeRoutineRuntime, evaluateRoutineRun } from "../domain/routines.js";
import { initializeWorkflowRuntime, evaluateWorkflowRun } from "../domain/workflows.js";
import { initializeProjectRuntime, evaluateProjectRun } from "../domain/projects.js";

function periodIdentity(ownerId, bounds, style) {
  return `${ownerId}:${style || "calendar"}:${bounds.key}`;
}

function ensurePeriod(state, owner, config, now, timezone, created) {
  const period = config.period || "day";
  if (["session", "all_time"].includes(period)) return null;
  const style = config.periodStyle || "calendar";
  const bounds = calculatePeriodBounds({
    period,
    style,
    at: now,
    timezone,
    weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1,
    rollingWindowDays: config.rollingWindowDays,
    customStart: config.customStart,
    customEnd: config.customEnd
  });
  const identity = periodIdentity(owner.id, bounds, style);
  let existing = (state.periods || []).find((item) =>
    item.identity === identity || item.ownerId === owner.id && item.key === bounds.key && item.style === style
  );
  if (!existing) {
    existing = createPeriod({
      ownerId: owner.id,
      period,
      style,
      at: now,
      timezone,
      weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1,
      rollingWindowDays: config.rollingWindowDays,
      customStart: config.customStart,
      customEnd: config.customEnd,
      snapshot: clone(config),
      now
    });
    existing.identity = identity;
    state.periods.push(existing);
    created.push(existing.id);
  }
  return existing;
}

function localDate(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function elapsedUnits(start, end, unit, timezone) {
  const a = new Date(start);
  const b = new Date(end);
  if (unit === "hours") return Math.floor((b - a) / 3600000);
  if (unit === "weeks") return Math.floor((b - a) / 86400000 / 7);
  if (unit === "months") {
    const left = partsInTimeZone(a, timezone);
    const right = partsInTimeZone(b, timezone);
    return (right.year - left.year) * 12 + right.month - left.month;
  }
  return Math.floor((b - a) / 86400000);
}

function addInterval(start, amount, unit, timezone) {
  const date = new Date(start);
  if (unit === "hours") return new Date(date.getTime() + amount * 3600000);
  if (unit === "weeks") return addCalendarDays(date, amount * 7, timezone);
  if (unit === "months") {
    const parts = partsInTimeZone(date, timezone);
    const anchor = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1, 12));
    const day = Math.min(parts.day, new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate());
    return addCalendarDays(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), day, 12)), 0, timezone);
  }
  return addCalendarDays(date, amount, timezone);
}

function latestCompletionAt(occurrences, logs, relationshipId) {
  const occurrenceIds = new Set(occurrences.filter((item) => item.relationshipId === relationshipId && item.status === "completed").map((item) => item.id));
  const matching = logs.filter((log) => log.contextRefs?.some((reference) =>
    reference.occurrenceId && occurrenceIds.has(reference.occurrenceId)
  ));
  return matching.map((log) => log.eventAt || log.createdAt).filter(Boolean).sort().at(-1) ||
    occurrences.filter((item) => occurrenceIds.has(item.id)).map((item) => item.updatedAt || item.createdAt).sort().at(-1) ||
    null;
}

function scheduleCandidate({ schedule, relationshipId, existing = [], now, timezone, logs = [] }) {
  if (!schedule || schedule.paused) return null;
  const mode = schedule.mode || "manual";
  if (schedule.activeFrom && new Date(now) < new Date(schedule.activeFrom)) return null;
  if (schedule.activeUntil && new Date(now) > new Date(schedule.activeUntil)) return null;
  if (mode === "manual") return null;
  if (mode === "once") {
    const scheduledAt = schedule.date || (schedule.anchorAt ? localDate(schedule.anchorAt, timezone) : localDate(now, timezone));
    if (existing.some((occurrence) => occurrence.relationshipId === relationshipId && occurrence.scheduledAt === scheduledAt)) return null;
    return { scheduledAt, sequence: schedule.sequence || 0 };
  }
  if (mode === "interval") {
    const anchorMode = schedule.anchor || "fixed";
    let anchorAt = schedule.anchorAt || null;
    if (anchorMode === "previous_occurrence") {
      const previous = existing.filter((item) => item.relationshipId === relationshipId).sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      ).at(-1);
      anchorAt = previous?.scheduledAt || previous?.createdAt || null;
    } else if (anchorMode === "previous_completion") {
      anchorAt = latestCompletionAt(existing, logs, relationshipId);
    }
    if (!anchorAt) return null;
    const every = Math.max(1, Number(schedule.every) || 1);
    const unit = schedule.unit || "days";
    const elapsed = elapsedUnits(anchorAt, now, unit, timezone);
    if (elapsed < every) return null;
    const slot = Math.floor(elapsed / every);
    const dueAt = addInterval(anchorAt, slot * every, unit, timezone);
    const scheduledAt = schedule.dateOnly === false ? dueAt.toISOString() : localDate(dueAt, timezone);
    if (existing.some((occurrence) => occurrence.relationshipId === relationshipId && occurrence.scheduledAt === scheduledAt)) return null;
    return { scheduledAt, sequence: slot };
  }
  if (!isScheduleDue({ schedule, at: now, timezone })) return null;
  const scheduledAt = schedule.dateOnly === false
    ? (schedule.time ? `${localDate(now, timezone)}T${schedule.time}` : now.toISOString())
    : localDate(now, timezone);
  if (existing.some((occurrence) => occurrence.relationshipId === relationshipId && occurrence.scheduledAt === scheduledAt)) return null;
  return { scheduledAt, sequence: schedule.sequence || 0 };
}

function blockSnapshot(block) {
  return {
    block: clone(block),
    relationships: clone(block.relationships || []),
    config: clone(block.config || {})
  };
}

function initializeRuntime(block, snapshot, now) {
  const source = { ...clone(block), ...clone(snapshot?.block || {}), relationships: clone(snapshot?.relationships || block.relationships || []) };
  if (block.type === "routine") return initializeRoutineRuntime({ routine: source, now });
  if (block.type === "workflow") return initializeWorkflowRuntime({ workflow: source, now });
  if (block.type === "project") return initializeProjectRuntime({ project: source, now });
  if (block.type === "cycle") return { type: "cycle", currentSmallCycleId: null, currentSlot: -1, smallCycleNumber: 0, appearanceCoverage: [], completionCoverage: [], startedAt: new Date(now).toISOString() };
  return null;
}

function applyEvaluatedRun(run, evaluated, now) {
  const stamp = new Date(now).toISOString();
  const next = { ...run, updatedAt: stamp };
  if (evaluated.children) {
    next.children = clone(evaluated.children);
    next.runtime = { ...(next.runtime || {}), children: clone(evaluated.children), progress: clone(evaluated.progress), updatedAt: stamp };
  }
  if (evaluated.steps) {
    next.steps = clone(evaluated.steps);
    next.currentStepId = evaluated.currentStepId || null;
    next.runtime = { ...(next.runtime || {}), steps: clone(evaluated.steps), currentStepId: next.currentStepId, updatedAt: stamp };
  }
  if (evaluated.progress) next.runtime = { ...(next.runtime || {}), progress: clone(evaluated.progress) };
  if (evaluated.results) next.runtime = { ...(next.runtime || {}), conditions: clone(evaluated.results) };
  if (evaluated.status && !["NOT_STARTED", "PAUSED"].includes(run.status)) {
    next.status = evaluated.status;
    if (["COMPLETED", "PARTIAL", "MISSED", "EXPIRED", "CANCELLED"].includes(evaluated.status)) {
      next.finishedAt = next.finishedAt || stamp;
    }
  }
  return next;
}

function reconcileRun(run, block, now) {
  if (!run || isRunTerminal(run) || run.status === "PAUSED") return run;
  const source = run.snapshot?.block || block;
  if (block.type === "routine") return applyEvaluatedRun(run, evaluateRoutineRun({ run, routine: source, now }), now);
  if (block.type === "workflow") return applyEvaluatedRun(run, evaluateWorkflowRun({ run, workflow: source, now }), now);
  if (block.type === "project") return applyEvaluatedRun(run, evaluateProjectRun({ project: source, run, now }), now);
  return run;
}

function activationCandidate({ activation, runs, occurrences, logs, now, timezone }) {
  if (!activation || activation.status !== "active" || isActivationEnded(activation, now)) return null;
  if (activation.mode === "manual") return null;
  if (activation.mode === "run_now" && Number(activation.runCount || 0) === 0) {
    return { scheduledAt: new Date(now).toISOString(), sequence: 0 };
  }
  const schedule = {
    ...(clone(activation.recurrence) || {}),
    mode: activation.recurrence?.mode || "once",
    anchorAt: activation.recurrence?.anchorAt || activation.startedAt || new Date(now).toISOString()
  };
  return scheduleCandidate({
    schedule,
    relationshipId: activation.id,
    existing: runs.filter((run) => run.activationId === activation.id).map((run) => ({
      relationshipId: activation.id,
      scheduledAt: run.scheduledAt,
      createdAt: run.createdAt,
      status: run.status
    })),
    logs,
    occurrences,
    now,
    timezone
  });
}

function createActivationRun(state, activation, block, candidate, now) {
  const snapshot = blockSnapshot(block);
  const runtime = initializeRuntime(block, snapshot, now);
  const run = startDomainRun(createRun({
    id: `run_${activation.id}_${String(candidate.scheduledAt || now.toISOString()).replace(/[^A-Za-z0-9_-]/g, "_")}`,
    blockId: block.id,
    activationId: activation.id,
    label: activation.label || block.name,
    snapshot,
    runtime,
    children: runtime?.children || [],
    steps: runtime?.steps || null,
    currentStepId: runtime?.currentStepId || null,
    plannedStart: candidate.scheduledAt || null,
    scheduledAt: candidate.scheduledAt || null,
    deadline: block.config?.deadline || null,
    activationSnapshot: clone(activation),
    now
  }), now);
  return run;
}

function markLegacyChildOccurrences(state, now, changed) {
  const relationshipMap = new Map();
  for (const block of state.blocks || []) for (const relationship of block.relationships || []) relationshipMap.set(relationship.id, block);
  for (const occurrence of state.occurrences || []) {
    const parent = relationshipMap.get(occurrence.relationshipId);
    if (parent && parent.type !== "action_list" && !occurrence.legacyGenericChild) {
      occurrence.legacyGenericChild = true;
      occurrence.runtimeBoundary = "legacy_child_occurrence";
      occurrence.updatedAt = new Date(now).toISOString();
      changed.push(occurrence.id);
    }
  }
}

export function reconcileTemporalState({
  repository,
  now = new Date(),
  timezone = repository.getState().settings?.timezone || "UTC"
} = {}) {
  return repository.transaction(() => {
    const state = repository.getState();
    const created = [];
    const closed = [];
    const changed = [];
    const historyEvents = [];
    const current = new Date(now);
    const logs = state.actionLogs || [];

    for (const period of state.periods || []) {
      if (period.status !== "open" || period.style === "rolling" || !period.end || current < new Date(period.end)) continue;
      const target = state.blocks?.find((block) => block.id === period.ownerId && block.type === "target");
      const avoidAction = state.actions?.find((action) => action.id === period.ownerId && action.direction === "avoid");
      const updated = evaluatePeriod({
        period,
        target,
        avoid: avoidAction?.avoid || period.snapshot?.avoid || null,
        logs,
        actions: state.actions || [],
        units: state.units || [],
        now: current
      });
      Object.assign(period, updated);
      closed.push(period.id);
      if (!(state.targetEvaluations || []).some((evaluation) => evaluation.periodId === period.id)) {
        state.targetEvaluations.push({
          id: `${period.id}:evaluation`,
          periodId: period.id,
          ownerId: period.ownerId,
          evaluation: clone(updated.evaluation),
          snapshot: clone(period.snapshot),
          closedAt: period.closedAt
        });
      }
      historyEvents.push({
        type: "PERIOD_CLOSED",
        description: `Closed period ${period.id}`,
        objectType: "period",
        objectId: period.id,
        snapshots: { evaluation: updated.evaluation }
      });
    }

    for (const target of state.blocks || []) {
      if (target.type === "target" && target.definitionStatus === "ACTIVE") {
        ensurePeriod(state, target, target.config || {}, current, timezone, created);
      }
    }
    for (const action of state.actions || []) {
      if (action.direction === "avoid" && (action.avoid || action.legacy?.avoid)?.period) {
        ensurePeriod(state, action, action.avoid || action.legacy.avoid, current, timezone, created);
      }
    }

    markLegacyChildOccurrences(state, current, changed);

    for (const activation of state.activations || []) {
      const block = state.blocks?.find((candidate) => candidate.id === activation.blockId);
      if (!block || block.definitionStatus !== "ACTIVE") continue;
      if (activation.status !== "active" || isActivationEnded(activation, current)) continue;
      const candidate = activationCandidate({
        activation,
        runs: state.runs || [],
        occurrences: state.occurrences || [],
        logs,
        now: current,
        timezone
      });
      if (!candidate) continue;
      const run = createActivationRun(state, activation, block, candidate, current);
      if ((state.runs || []).some((existing) => existing.id === run.id || existing.activationId === activation.id && existing.scheduledAt === run.scheduledAt)) continue;
      state.runs.push(run);
      Object.assign(activation, recordActivationRun(activation, current));
      created.push(run.id);
      historyEvents.push({
        type: "RUN_CREATED",
        description: `Created ${block.type} Run from activation`,
        objectType: "run",
        objectId: run.id,
        snapshots: { run: clone(run.snapshot), activation: clone(activation) }
      });
    }

    for (const run of state.runs || []) {
      const block = state.blocks?.find((candidate) => candidate.id === run.blockId);
      if (!block) continue;
      const evaluated = reconcileRun(run, block, current);
      if (evaluated !== run && JSON.stringify(evaluated) !== JSON.stringify(run)) {
        Object.assign(run, evaluated);
        changed.push(run.id);
        historyEvents.push({
          type: "RUN_STATE_CHANGED",
          description: `Updated ${block.type} Run runtime`,
          objectType: "run",
          objectId: run.id,
          metadata: { status: run.status }
        });
      }
    }

    for (const occurrence of state.occurrences || []) {
      const relationship = state.blocks?.flatMap((block) => block.relationships || [])
        .find((candidate) => candidate.id === occurrence.relationshipId);
      const action = relationship?.kind === "action"
        ? state.actions?.find((candidate) => candidate.id === relationship.refId)
        : null;
      const paused = relationship?.config?.schedule?.paused;
      const status = paused && !["completed", "skipped", "missed", "expired", "excused", "not_applicable"].includes(occurrence.status)
        ? "paused"
        : resolveOccurrenceStatus({
          occurrence,
          logs,
          action,
          now: current,
          unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy ||
            relationship?.config?.unfinishedPolicy ||
            (state.settings?.defaults?.actionListExpire === false ? "carry_forward" : "expire")
        });
      if (status !== occurrence.status) {
        occurrence.status = status;
        occurrence.updatedAt = current.toISOString();
        changed.push(occurrence.id);
        historyEvents.push({
          type: status === "missed" ? "OCCURRENCE_MISSED" : "OCCURRENCE_STATUS_CHANGED",
          description: `${status} occurrence`,
          objectType: "occurrence",
          objectId: occurrence.id
        });
      }
    }

    for (const block of state.blocks || []) {
      if (block.definitionStatus !== "ACTIVE" || block.type !== "action_list") continue;
      const enabledByActivation = (state.activations || []).filter((activation) => activation.blockId === block.id);
      if (enabledByActivation.length && !enabledByActivation.some((activation) =>
        activation.status === "active" && !isActivationEnded(activation, current)
      )) continue;
      for (const relationship of block.relationships || []) {
        if (relationship.kind !== "action") continue;
        const action = state.actions?.find((candidate) => candidate.id === relationship.refId);
        if (!action || action.direction === "avoid") continue;
        const schedule = relationship.config?.schedule;
        const existing = state.occurrences || [];
        const candidate = scheduleCandidate({
          schedule,
          relationshipId: relationship.id,
          existing,
          logs,
          now: current,
          timezone
        });
        if (!candidate) continue;
        try {
          validateActionListSchedule(schedule);
        } catch {
          continue;
        }
        if (!shouldGenerateScheduledOccurrence({
          schedule,
          existingOccurrences: existing,
          relationshipId: relationship.id,
          now: current
        })) continue;
        const identity = occurrenceIdentity({
          relationshipId: relationship.id,
          scheduledAt: candidate.scheduledAt,
          sequence: candidate.sequence
        });
        if (existing.some((occurrence) => occurrence.identity === identity)) continue;
        const defaultDeadline = schedule.dateOnly === false
          ? null
          : calculatePeriodBounds({ period: "day", at: current, timezone }).end;
        if (schedule.overlap === "replace_previous") {
          for (const previous of existing.filter((item) =>
            item.relationshipId === relationship.id &&
            !["completed", "skipped", "missed", "expired", "excused", "not_applicable"].includes(item.status)
          )) {
            previous.status = "expired";
            previous.replacedAt = current.toISOString();
            previous.updatedAt = current.toISOString();
            historyEvents.push({
              type: "OCCURRENCE_REPLACED",
              description: `Replaced occurrence ${previous.id}`,
              objectType: "occurrence",
              objectId: previous.id
            });
          }
        }
        const occurrence = createOccurrence({
          id: identity.replace(/[^A-Za-z0-9_-]/g, "_"),
          relationshipId: relationship.id,
          scheduledAt: candidate.scheduledAt,
          availableFrom: schedule.availableFrom || relationship.config?.availableFrom || null,
          deadline: schedule.deadline || relationship.config?.deadline || defaultDeadline,
          status: schedule.mode === "always_available" ? "available" : "due",
          snapshot: {
            identity,
            actionId: relationship.refId,
            schedule: clone(schedule),
            unfinishedPolicy: relationship.config?.unfinishedPolicy ||
              (state.settings?.defaults?.actionListExpire === false ? "carry_forward" : "expire")
          },
          now: current
        });
        occurrence.identity = identity;
        state.occurrences.push(occurrence);
        created.push(occurrence.id);
        historyEvents.push({
          type: "OCCURRENCE_CREATED",
          description: `Created occurrence for ${relationship.id}`,
          objectType: "occurrence",
          objectId: occurrence.id
        });
      }
    }

    for (const event of historyEvents) {
      state.history = appendHistory(state.history || [], { ...event, timestamp: current });
    }
    state.updatedAt = current.toISOString();
    return { created, closed, changed };
  });
}
