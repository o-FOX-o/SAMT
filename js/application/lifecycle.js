import { calculatePeriodBounds, addCalendarDays, partsInTimeZone } from "../shared/dates.js";
import { createPeriod } from "../domain/periods.js";
import { createOccurrence, resolveOccurrenceStatus } from "../domain/occurrences.js";
import { occurrenceIdentity, isScheduleDue } from "../domain/scheduling.js";
import { evaluatePeriod } from "../domain/evaluation.js";
import { appendHistory } from "../domain/history.js";
import { shouldGenerateScheduledOccurrence, validateActionListSchedule } from "../domain/action-lists.js";
import { clone } from "../shared/validation.js";

function periodIdentity(ownerId, bounds, style) { return `${ownerId}:${style || "calendar"}:${bounds.key}`; }

function ensurePeriod(state, owner, config, now, timezone, created) {
  const period = config.period || "day";
  if (["session", "all_time"].includes(period)) return null;
  const style = config.periodStyle || "calendar";
  const bounds = calculatePeriodBounds({ period, style, at: now, timezone, weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1, customStart: config.customStart, customEnd: config.customEnd });
  const identity = periodIdentity(owner.id, bounds, style);
  let existing = (state.periods || []).find((item) => item.identity === identity || item.ownerId === owner.id && item.key === bounds.key && item.style === style);
  if (!existing) {
    existing = createPeriod({ ownerId: owner.id, period, style, at: now, timezone, weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1, customStart: config.customStart, customEnd: config.customEnd, snapshot: clone(config), now });
    existing.identity = identity; state.periods.push(existing); created.push(existing.id);
  }
  return existing;
}

function localDate(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function elapsedUnits(start, end, unit, timezone) {
  const a = new Date(start); const b = new Date(end);
  if (unit === "hours") return Math.floor((b - a) / 3600000);
  if (unit === "weeks") return Math.floor((b - a) / 86400000 / 7);
  if (unit === "months") { const left = partsInTimeZone(a, timezone); const right = partsInTimeZone(b, timezone); return (right.year - left.year) * 12 + right.month - left.month; }
  return Math.floor((b - a) / 86400000);
}

function addInterval(start, amount, unit, timezone) {
  const date = new Date(start);
  if (unit === "hours") return new Date(date.getTime() + amount * 3600000);
  if (unit === "weeks") return addCalendarDays(date, amount * 7, timezone);
  if (unit === "months") {
    const parts = partsInTimeZone(date, timezone); const anchor = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1, 12));
    const day = Math.min(parts.day, new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate());
    return addCalendarDays(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), day, 12)), 0, timezone);
  }
  return addCalendarDays(date, amount, timezone);
}

function scheduleCandidate({ schedule, relationshipId, existing = [], now, timezone }) {
  if (!schedule || schedule.paused) return null;
  const mode = schedule.mode || "manual"; if (mode === "manual") return null;
  if (mode === "once") {
    const scheduledAt = schedule.date || (schedule.anchorAt ? localDate(schedule.anchorAt, timezone) : localDate(now, timezone));
    if (existing.some((occurrence) => occurrence.relationshipId === relationshipId && occurrence.scheduledAt === scheduledAt)) return null;
    return { scheduledAt, sequence: schedule.sequence || 0 };
  }
  if (mode === "interval") {
    if (!schedule.anchorAt) return null;
    const every = Math.max(1, Number(schedule.every) || 1); const unit = schedule.unit || "days"; const elapsed = elapsedUnits(schedule.anchorAt, now, unit, timezone);
    if (elapsed < every) return null;
    const slot = Math.floor(elapsed / every); const dueAt = addInterval(schedule.anchorAt, slot * every, unit, timezone); const scheduledAt = schedule.dateOnly === false ? dueAt.toISOString() : localDate(dueAt, timezone);
    if (existing.some((occurrence) => occurrence.relationshipId === relationshipId && occurrence.scheduledAt === scheduledAt)) return null;
    return { scheduledAt, sequence: slot };
  }
  if (!isScheduleDue({ schedule, at: now, timezone })) return null;
  const scheduledAt = schedule.dateOnly === false ? (schedule.time ? `${localDate(now, timezone)}T${schedule.time}` : now.toISOString()) : localDate(now, timezone);
  if (existing.some((occurrence) => occurrence.relationshipId === relationshipId && occurrence.scheduledAt === scheduledAt)) return null;
  return { scheduledAt, sequence: schedule.sequence || 0 };
}

export function reconcileTemporalState({ repository, now = new Date(), timezone = repository.getState().settings?.timezone || "UTC" } = {}) {
  return repository.transaction(() => {
    const state = repository.getState(); const created = []; const closed = []; const changed = []; const current = new Date(now); const historyEvents = [];
    for (const period of state.periods || []) if (period.status === "open" && period.style !== "rolling" && period.end && current >= new Date(period.end)) {
      const target = state.blocks?.find((block) => block.id === period.ownerId && block.type === "target"); const avoidAction = state.actions?.find((action) => action.id === period.ownerId && action.direction === "avoid");
      const updated = evaluatePeriod({ period, target, avoid: avoidAction?.avoid || period.snapshot?.avoid || null, logs: state.actionLogs || [], actions: state.actions || [], units: state.units || [], now: current }); Object.assign(period, updated); closed.push(period.id);
      if (!(state.targetEvaluations || []).some((evaluation) => evaluation.periodId === period.id)) state.targetEvaluations.push({ id: `${period.id}:evaluation`, periodId: period.id, ownerId: period.ownerId, evaluation: clone(updated.evaluation), snapshot: clone(period.snapshot), closedAt: period.closedAt });
      historyEvents.push({ type: "PERIOD_CLOSED", description: `Closed period ${period.id}`, objectType: "period", objectId: period.id, snapshots: { evaluation: updated.evaluation } });
    }
    for (const target of state.blocks || []) if (target.type === "target" && target.definitionStatus === "ACTIVE") ensurePeriod(state, target, target.config || {}, current, timezone, created);
    for (const action of state.actions || []) if (action.direction === "avoid" && (action.avoid || action.legacy?.avoid)?.period) ensurePeriod(state, action, action.avoid || action.legacy.avoid, current, timezone, created);
    for (const occurrence of state.occurrences || []) {
      const relationship = state.blocks?.flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId); const action = relationship?.kind === "action" ? state.actions?.find((candidate) => candidate.id === relationship.refId) : null;
      const paused = relationship?.config?.schedule?.paused;
      const status = paused && !["completed", "skipped", "missed", "expired", "excused", "not_applicable"].includes(occurrence.status) ? "paused" : resolveOccurrenceStatus({ occurrence, logs: state.actionLogs || [], action, now: current, unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy || relationship?.config?.unfinishedPolicy || "expire" });
      if (status !== occurrence.status) { occurrence.status = status; occurrence.updatedAt = current.toISOString(); changed.push(occurrence.id); historyEvents.push({ type: status === "missed" ? "OCCURRENCE_MISSED" : "OCCURRENCE_STATUS_CHANGED", description: `${status} occurrence`, objectType: "occurrence", objectId: occurrence.id }); }
    }
    for (const block of state.blocks || []) {
      if (block.definitionStatus !== "ACTIVE") continue;
      for (const relationship of block.relationships || []) {
        const schedule = relationship.config?.schedule; const existing = state.occurrences || []; const candidate = scheduleCandidate({ schedule, relationshipId: relationship.id, existing, now: current, timezone }); if (!candidate) continue;
        try { validateActionListSchedule(schedule); } catch { continue; }
        if (!shouldGenerateScheduledOccurrence({ schedule, existingOccurrences: existing, relationshipId: relationship.id, now: current })) continue;
        const identity = occurrenceIdentity({ relationshipId: relationship.id, scheduledAt: candidate.scheduledAt, sequence: candidate.sequence });
        if (existing.some((occurrence) => occurrence.identity === identity)) continue;
        const defaultDeadline = schedule.dateOnly === false ? null : calculatePeriodBounds({ period: "day", at: current, timezone }).end;
        const occurrence = createOccurrence({ id: identity.replace(/[^A-Za-z0-9_-]/g, "_"), relationshipId: relationship.id, scheduledAt: candidate.scheduledAt, availableFrom: schedule.availableFrom || null, deadline: schedule.deadline || defaultDeadline, status: schedule.mode === "always_available" ? "available" : "due", snapshot: { identity, actionId: relationship.refId, schedule: clone(schedule), unfinishedPolicy: relationship.config?.unfinishedPolicy || "expire" }, now: current }); occurrence.identity = identity; state.occurrences.push(occurrence); created.push(occurrence.id); historyEvents.push({ type: "OCCURRENCE_CREATED", description: `Created occurrence for ${relationship.id}`, objectType: "occurrence", objectId: occurrence.id });
      }
    }
    for (const event of historyEvents) state.history = appendHistory(state.history || [], { ...event, timestamp: current });
    state.updatedAt = current.toISOString(); return { created, closed, changed };
  });
}
