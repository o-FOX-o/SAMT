import { calculatePeriodBounds } from "../shared/dates.js";
import { createPeriod } from "../domain/periods.js";
import { createOccurrence, resolveOccurrenceStatus } from "../domain/occurrences.js";
import { occurrenceIdentity } from "../domain/scheduling.js";
import { evaluatePeriod } from "../domain/evaluation.js";
import { clone } from "../shared/validation.js";

export function reconcileTemporalState({ repository, now = new Date(), timezone = "UTC" } = {}) {
  return repository.transaction(() => {
    const state = repository.getState(); const created = []; const closed = []; const changed = [];
    // Close and record any expired open periods. A stable owner/key pair makes this idempotent.
    for (const period of state.periods || []) if (period.status === "open" && period.end && new Date(now) >= new Date(period.end)) {
      const target = state.blocks?.find((block) => block.id === period.ownerId && block.type === "target"); const avoid = state.actions?.find((action) => action.id === period.ownerId && action.direction === "avoid")?.avoid;
      const updated = evaluatePeriod({ period, target, avoid, logs: state.actionLogs || [], actions: state.actions || [], units: state.units || [], now }); Object.assign(period, updated); closed.push(period.id);
      if (target) state.targetEvaluations.push({ periodId: period.id, ownerId: period.ownerId, evaluation: clone(updated.evaluation), snapshot: clone(period.snapshot) });
    }
    // Re-evaluate existing occurrences; never create a duplicate identity.
    for (const occurrence of state.occurrences || []) { const action = state.actions?.find((candidate) => candidate.id === occurrence.snapshot?.actionId); const status = resolveOccurrenceStatus({ occurrence, logs: state.actionLogs || [], action, now, unfinishedPolicy: occurrence.snapshot?.unfinishedPolicy || "expire" }); if (status !== occurrence.status) { occurrence.status = status; occurrence.updatedAt = new Date(now).toISOString(); changed.push(occurrence.id); } }
    // Generate a single occurrence for an active daily/weekday relationship at a time.
    for (const block of state.blocks || []) for (const relationship of block.relationships || []) {
      const schedule = relationship.config?.schedule; if (!schedule || block.definitionStatus !== "ACTIVE") continue;
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); const identity = occurrenceIdentity({ relationshipId: relationship.id, scheduledAt: date });
      if (schedule.mode === "calendar" && schedule.calendarKind === "daily" && !(state.occurrences || []).some((occurrence) => occurrence.identity === identity)) { const occurrence = createOccurrence({ id: identity.replace(/[^A-Za-z0-9_-]/g, "_"), relationshipId: relationship.id, scheduledAt: date, deadline: schedule.deadline || null, status: "due", snapshot: { identity, actionId: relationship.refId, unfinishedPolicy: relationship.config.unfinishedPolicy || "expire" }, now }); occurrence.identity = identity; state.occurrences.push(occurrence); created.push(occurrence.id); }
    }
    return { created, closed, changed };
  });
}
