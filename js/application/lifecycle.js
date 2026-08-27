import { calculatePeriodBounds } from "../shared/dates.js";
import { createPeriod } from "../domain/periods.js";
import { createOccurrence, resolveOccurrenceStatus } from "../domain/occurrences.js";
import { occurrenceIdentity, isScheduleDue } from "../domain/scheduling.js";
import { evaluatePeriod } from "../domain/evaluation.js";
import { clone } from "../shared/validation.js";

function periodIdentity(ownerId, bounds, style) { return `${ownerId}:${style || "calendar"}:${bounds.key}`; }

function ensurePeriod(state, owner, config, now, timezone, created) {
  const period = config.period || "day"; if (["session", "all_time"].includes(period)) return null;
  const style = config.periodStyle || "calendar"; const bounds = calculatePeriodBounds({ period, style, at: now, timezone, weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1 }); const identity = periodIdentity(owner.id, bounds, style);
  let existing = state.periods.find((item) => item.identity === identity || item.ownerId === owner.id && item.key === bounds.key && item.style === style);
  if (!existing) { existing = createPeriod({ ownerId: owner.id, period, style, at: now, timezone, weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1, snapshot: clone(config), now }); existing.identity = identity; state.periods.push(existing); created.push(existing.id); }
  return existing;
}

function relationshipScheduleDue(schedule, now, timezone) {
  if (!schedule) return false;
  if (schedule.mode === "calendar" || schedule.mode === "once") return isScheduleDue({ schedule, at: now, timezone });
  if (schedule.mode === "always_available") return true;
  return false;
}

function localDate(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])); return `${map.year}-${map.month}-${map.day}`;
}

export function reconcileTemporalState({ repository, now = new Date(), timezone = repository.getState().settings?.timezone || "UTC" } = {}) {
  return repository.transaction(() => {
    const state = repository.getState(); const created = []; const closed = []; const changed = []; const current = new Date(now);
    for (const period of state.periods || []) if (period.status === "open" && period.end && current >= new Date(period.end)) {
      const target = state.blocks?.find((block) => block.id === period.ownerId && block.type === "target"); const avoidAction = state.actions?.find((action) => action.id === period.ownerId && action.direction === "avoid");
      const updated = evaluatePeriod({ period, target, avoid: avoidAction?.avoid || period.snapshot?.avoid || null, logs: state.actionLogs || [], actions: state.actions || [], units: state.units || [], now: current }); Object.assign(period, updated); closed.push(period.id);
      state.targetEvaluations.push({ id: `${period.id}:evaluation`, periodId: period.id, ownerId: period.ownerId, evaluation: clone(updated.evaluation), snapshot: clone(period.snapshot), closedAt: period.closedAt });
    }
    for (const target of state.blocks || []) if (target.type === "target" && target.definitionStatus === "ACTIVE") ensurePeriod(state, target, target.config || {}, current, timezone, created);
    for (const action of state.actions || []) if (action.direction === "avoid" && action.avoid?.period) ensurePeriod(state, action, action.avoid, current, timezone, created);
    for (const occurrence of state.occurrences || []) {
      const relationship = state.blocks?.flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId); const action = relationship?.kind === "action" ? state.actions?.find((candidate) => candidate.id === relationship.refId) : null;
      const status = resolveOccurrenceStatus({ occurrence, logs: state.actionLogs || [], action, now: current, unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy || relationship?.config?.unfinishedPolicy || "expire" });
      if (status !== occurrence.status) { occurrence.status = status; occurrence.updatedAt = current.toISOString(); changed.push(occurrence.id); }
    }
    for (const block of state.blocks || []) {
      if (block.definitionStatus !== "ACTIVE") continue;
      for (const relationship of block.relationships || []) {
        const schedule = relationship.config?.schedule; if (!relationship || !schedule || !relationshipScheduleDue(schedule, current, timezone)) continue;
        const date = localDate(current, timezone); const scheduledAt = schedule.dateOnly === false ? current.toISOString() : date; const identity = occurrenceIdentity({ relationshipId: relationship.id, scheduledAt, sequence: schedule.sequence || 0 });
        if ((state.occurrences || []).some((occurrence) => occurrence.identity === identity || occurrence.relationshipId === relationship.id && occurrence.scheduledAt === scheduledAt)) continue;
        const defaultDeadline = schedule.dateOnly === false ? null : calculatePeriodBounds({ period: "day", at: current, timezone }).end;
        const occurrence = createOccurrence({ id: identity.replace(/[^A-Za-z0-9_-]/g, "_"), relationshipId: relationship.id, scheduledAt, availableFrom: schedule.availableFrom || null, deadline: schedule.deadline || defaultDeadline, status: schedule.mode === "always_available" ? "available" : "due", snapshot: { identity, actionId: relationship.refId, schedule: clone(schedule), unfinishedPolicy: relationship.config?.unfinishedPolicy || "expire" }, now: current }); occurrence.identity = identity; state.occurrences.push(occurrence); created.push(occurrence.id);
      }
    }
    return { created, closed, changed };
  });
}
