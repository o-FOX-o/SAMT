import { finiteNumber, percentage } from "../shared/numbers.js";
import { clone } from "../shared/validation.js";
import { ValidationError } from "../shared/errors.js";

export const ROUTINE_COMPLETION_MODES = ["count", "percentage", "required_only", "manual"];
export const ROUTINE_CHILD_STATES = ["AVAILABLE", "IN_PROGRESS", "COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "OVERDUE", "BLOCKED", "CANCELLED"];

function relationshipsFor(routine = {}) { return routine?.relationships || routine?.snapshot?.relationships || routine?.snapshot?.block?.relationships || []; }
function configFor(routine = {}) { return routine?.config || routine?.snapshot?.config || routine?.snapshot?.block?.config || routine || {}; }
export function isRoutineChildSatisfied(child = {}) { return ["COMPLETED", "EXCUSED", "NOT_APPLICABLE", "completed", "excused", "not_applicable"].includes(child.state || child.status); }

export function initializeRoutineRuntime({ routine = {}, now = new Date() } = {}) {
  const stamp = new Date(now).toISOString();
  const children = relationshipsFor(routine).map((relationship, position) => {
    const config = relationship.config || {};
    return { id: relationship.id, relationshipId: relationship.id, kind: relationship.kind, refId: relationship.refId, label: relationship.label || null, position, required: config.required === true, allowSkip: config.allowSkip === true, requireSkipReason: config.requireSkipReason === true, allowExcuse: config.allowExcuse === true || config.excuseAllowed === true, allowNotApplicable: config.allowNotApplicable === true || config.allowNA === true, allowComments: config.allowComments === true, allowExtraLogs: config.allowExtraLogs === true, availableFrom: config.availableFrom || config.timing?.availableFrom || null, deadline: config.deadline || config.timing?.deadline || null, timing: clone(config.timing || null), state: "AVAILABLE", available: true, logIds: [], completedLogIds: [], skipReason: null, blockedReason: null, createdAt: stamp, updatedAt: stamp };
  });
  return { type: "routine", children, startedAt: stamp, updatedAt: stamp, progress: calculateRoutineProgress({ relationships: children, children }) };
}

export function calculateRoutineProgress({ relationships = [], completedRelationshipIds = [], requiredRelationshipIds = [], children = [] } = {}) {
  const source = children.length ? children : relationships; const completed = new Set(completedRelationshipIds);
  for (const child of source) if (isRoutineChildSatisfied(child)) completed.add(child.relationshipId || child.id);
  const required = new Set(requiredRelationshipIds.length ? requiredRelationshipIds : source.filter((relationship) => relationship.required || relationship.config?.required === true).map((relationship) => relationship.relationshipId || relationship.id));
  const total = relationships.length || source.length; const count = source.filter((relationship) => completed.has(relationship.relationshipId || relationship.id)).length; const requiredSatisfied = [...required].every((id) => completed.has(id));
  return { total, completed: count, percentage: total ? percentage(count, total) : 0, requiredSatisfied, completedRelationshipIds: [...completed], requiredRelationshipIds: [...required] };
}

export function isRoutineQualified({ routine, progress } = {}) {
  const config = configFor(routine); const mode = config.completionMode || "required_only";
  if (!ROUTINE_COMPLETION_MODES.includes(mode)) throw new ValidationError("Routine completion mode is invalid.");
  const minimum = Math.max(0, Math.floor(finiteNumber(config.minimumCount, 0))); const threshold = finiteNumber(config.minimumPercentage, 100);
  if (!progress?.requiredSatisfied) return false;
  if (mode === "count") return progress.completed >= minimum;
  if (mode === "percentage") return progress.percentage >= threshold;
  if (mode === "manual") return false;
  return true;
}

export function routineProgressFromRun(run = {}) {
  const routine = run.snapshot?.block || run.snapshot || {};
  const relationships = run.snapshot?.relationships || routine.relationships || [];
  return calculateRoutineProgress({ relationships, children: run.children || run.runtime?.children || [] });
}

export function resolveRoutineDeadline({ progress, routine, now = new Date(), deadline = null, finished = false } = {}) {
  const current = new Date(now); const qualified = isRoutineQualified({ routine, progress }); const config = configFor(routine); const manuallyQualified = config.completionMode === "manual" && Boolean(progress?.requiredSatisfied);
  if (finished && (qualified || manuallyQualified)) return { status: "COMPLETED", qualified: true, readyToFinish: false, closedAt: current.toISOString() };
  if (deadline && current >= new Date(deadline)) {
    if (qualified || manuallyQualified) return { status: "COMPLETED", qualified: true, readyToFinish: false, closedAt: current.toISOString() };
    return { status: progress?.completed > 0 ? "PARTIAL" : "MISSED", qualified: false, readyToFinish: false, closedAt: current.toISOString() };
  }
  if (qualified) return { status: config.finishBehaviour === "ready" ? "READY_TO_FINISH" : "COMPLETED", qualified: true, readyToFinish: config.finishBehaviour === "ready", closedAt: null };
  return { status: progress?.completed > 0 ? "IN_PROGRESS" : "NOT_STARTED", qualified: false, readyToFinish: false, closedAt: null };
}

export function evaluateRoutineRun({ run, routine = null, now = new Date(), finished = false } = {}) {
  if (!run) throw new ValidationError("Routine Run is required.");
  const source = routine || run.snapshot?.block || run.snapshot || {}; const current = new Date(now);
  const children = (run.children || run.runtime?.children || []).map((child) => {
    if (["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "CANCELLED"].includes(child.state)) return child;
    if (child.availableFrom && Number.isFinite(new Date(child.availableFrom).getTime()) && current < new Date(child.availableFrom)) return { ...child, available: false };
    const deadline = child.deadline || child.timing?.deadline;
    if (deadline && Number.isFinite(new Date(deadline).getTime()) && current >= new Date(deadline)) return { ...child, state: "OVERDUE", overdueAt: child.overdueAt || current.toISOString(), available: true };
    return { ...child, available: true };
  });
  const progress = routineProgressFromRun({ ...run, children }); const evaluation = resolveRoutineDeadline({ progress, routine: source, deadline: run.deadline || source.config?.deadline || null, now: current, finished });
  return { ...evaluation, progress, children, status: evaluation.status };
}

export function updateRoutineChild({ run, relationshipId, state, logId = null, reason = null, now = new Date() } = {}) {
  if (!run || !relationshipId || !ROUTINE_CHILD_STATES.includes(state)) throw new ValidationError("Routine child update is invalid.");
  const stamp = new Date(now).toISOString(); const source = run.children || run.runtime?.children || []; const child = source.find((candidate) => (candidate.relationshipId || candidate.id) === relationshipId);
  if (!child) throw new ValidationError("Routine child does not exist.");
  if (state === "SKIPPED" && child.required) throw new ValidationError("Required Routine children cannot be skipped.");
  if (state === "SKIPPED" && child.allowSkip !== true) throw new ValidationError("Skipping this Routine child is not allowed.");
  if (state === "SKIPPED" && child.requireSkipReason && !String(reason || "").trim()) throw new ValidationError("A skip reason is required.");
  if (state === "EXCUSED" && child.allowExcuse !== true) throw new ValidationError("Excusing this Routine child is not allowed.");
  if (state === "NOT_APPLICABLE" && child.allowNotApplicable !== true) throw new ValidationError("Marking this Routine child not applicable is not allowed.");
  const children = source.map((candidate) => {
    if ((candidate.relationshipId || candidate.id) !== relationshipId) return candidate;
    const logIds = logId ? [...new Set([...(candidate.logIds || []), logId])] : [...(candidate.logIds || [])];
    const completedLogIds = state === "COMPLETED" && logId ? [...new Set([...(candidate.completedLogIds || []), logId])] : [...(candidate.completedLogIds || [])];
    return { ...candidate, state, logIds, completedLogIds, skipReason: state === "SKIPPED" ? reason || null : candidate.skipReason || null, reason: reason || candidate.reason || null, updatedAt: stamp };
  });
  const progress = calculateRoutineProgress({ relationships: run.snapshot?.relationships || [], children });
  return { ...run, children, runtime: { ...(run.runtime || {}), type: "routine", children: clone(children), progress, updatedAt: stamp }, updatedAt: stamp };
}
