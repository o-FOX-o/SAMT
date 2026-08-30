import { ValidationError } from "../shared/errors.js";
import { clone } from "../shared/validation.js";

export const WORKFLOW_STEP_STATES = ["LOCKED", "AVAILABLE", "IN_PROGRESS", "COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "OVERDUE", "BLOCKED", "CANCELLED"];
export const WORKFLOW_TERMINAL_STEP_STATES = ["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "CANCELLED"];

function workflowRelationships(workflow = {}) { return workflow?.relationships || workflow?.snapshot?.relationships || workflow?.snapshot?.block?.relationships || []; }
function workflowConfig(workflow = {}) { return workflow?.config || workflow?.snapshot?.config || workflow?.snapshot?.block?.config || workflow || {}; }
export function isWorkflowStepSatisfied(step = {}) { return ["COMPLETED", "EXCUSED", "NOT_APPLICABLE", "completed", "excused", "not_applicable"].includes(step.state); }

function addWorkflowDelay(value, amount, unit = "hours") {
  const date = new Date(value);
  const count = Number(amount || 0);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(count) || count <= 0) return date.toISOString();
  if (unit === "months") date.setMonth(date.getMonth() + count);
  else date.setTime(date.getTime() + count * (unit === "weeks" ? 604800000 : unit === "days" ? 86400000 : 3600000));
  return date.toISOString();
}

export function initializeWorkflowRuntime({ workflow = {}, now = new Date() } = {}) {
  const stamp = new Date(now).toISOString(); const relationships = workflowRelationships(workflow);
  const steps = relationships.map((relationship, position) => {
    const config = relationship.config || {};
    return createWorkflowStep({ id: relationship.id, relationshipId: relationship.id, name: relationship.label || relationship.name || ("Step " + (position + 1)), required: config.required !== false, state: (config.predecessorId || config.dependsOnRelationshipId || position) ? "LOCKED" : "AVAILABLE", position, predecessorId: config.predecessorId || config.dependsOnRelationshipId || (position ? relationships[position - 1].id : null), timing: config.timing || null, availabilityMode: config.availabilityMode || config.timing?.availabilityMode || "immediate", delayValue: config.delayValue ?? config.timing?.delayValue ?? null, delayUnit: config.delayUnit || config.timing?.delayUnit || "hours", availableFrom: config.availableFrom || config.timing?.availableFrom || null, deadline: config.deadline || config.timing?.deadline || null, allowSkip: config.allowSkip === true, requireSkipReason: config.requireSkipReason === true, allowExcuse: config.allowExcuse === true || config.excuseAllowed === true, allowNotApplicable: config.allowNotApplicable === true || config.allowNA === true, createdAt: stamp });
  });
  return { type: "workflow", steps, currentStepId: steps[0]?.id || null, transitions: [], startedAt: stamp, updatedAt: stamp };
}

export function nextWorkflowStep({ steps = [], currentStepId = null } = {}) {
  const index = currentStepId == null ? -1 : steps.findIndex((step) => step.id === currentStepId);
  return steps.slice(index + 1).find((step) => !WORKFLOW_TERMINAL_STEP_STATES.includes(step.state) && step.state !== "BLOCKED") || null;
}

export function resolveWorkflowCompletion({ steps = [] } = {}) {
  const required = steps.filter((step) => step.required !== false); const satisfied = required.every(isWorkflowStepSatisfied);
  const terminal = satisfied && steps.every((step) => WORKFLOW_TERMINAL_STEP_STATES.includes(step.state) || step.required === false);
  return { satisfied, terminal, requiredCount: required.length, satisfiedCount: required.filter(isWorkflowStepSatisfied).length };
}

export function returnToWorkflowStep({ steps = [], stepId, now = new Date() } = {}) {
  const index = steps.findIndex((step) => step.id === stepId); if (index < 0) throw new ValidationError("Workflow step does not exist.");
  const descendants = new Set();
  const visit = (id) => {
    for (const step of steps) if (step.predecessorId === id && !descendants.has(step.id)) { descendants.add(step.id); visit(step.id); }
  };
  visit(stepId);
  const reopenedAt = new Date(now).toISOString();
  return steps.map((step, current) => {
    const downstream = descendants.size ? descendants.has(step.id) : current > index;
    return current === index
      ? { ...step, state: "AVAILABLE", reopenedAt, reopenedFromState: step.state }
      : downstream
        ? { ...step, state: "LOCKED", reopenedAt, reopenedFromState: step.state }
        : step;
  });
}

export function createWorkflowStep({ id, relationshipId = null, name = "", required = true, state = "LOCKED", position = 0, timing = null, availabilityMode = "immediate", delayValue = null, delayUnit = "hours", predecessorId = null, availableFrom = null, deadline = null, allowSkip = false, requireSkipReason = false, allowExcuse = false, allowNotApplicable = false, createdAt = null } = {}) {
  if (!id || !String(name || "").trim()) throw new ValidationError("Workflow step requires an ID and name.");
  if (!WORKFLOW_STEP_STATES.includes(state)) throw new ValidationError("Workflow step state is invalid.");
  return { id, relationshipId, name: String(name).trim(), required: required !== false, state, position: Math.max(0, Number(position) || 0), timing: clone(timing), availabilityMode, delayValue: delayValue == null ? null : Number(delayValue), delayUnit, predecessorId, availableFrom, deadline, allowSkip: Boolean(allowSkip), requireSkipReason: Boolean(requireSkipReason), allowExcuse: Boolean(allowExcuse), allowNotApplicable: Boolean(allowNotApplicable), createdAt, resolvedAt: null, reason: null };
}

export function resolveWorkflowStep({ step, state, reason = null, now = new Date(), allowSkip = step?.allowSkip, allowExcuse = step?.allowExcuse, allowNotApplicable = step?.allowNotApplicable } = {}) {
  if (!step || !WORKFLOW_STEP_STATES.includes(state)) throw new ValidationError("Workflow step resolution is invalid.");
  if (["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE"].includes(step.state) && state !== step.state) throw new ValidationError("A terminal Workflow step must be returned to before it can change.");
  if (state === "IN_PROGRESS" && !["AVAILABLE", "IN_PROGRESS", "OVERDUE"].includes(step.state)) throw new ValidationError("Only an available Workflow step can start.");
  if (state === "COMPLETED" && !["AVAILABLE", "IN_PROGRESS", "OVERDUE"].includes(step.state)) throw new ValidationError("Only an available Workflow step can complete.");
  if (state === "AVAILABLE" && !["LOCKED", "BLOCKED", "OVERDUE", "AVAILABLE"].includes(step.state)) throw new ValidationError("This Workflow step is not available to reopen.");
  if (state === "IN_PROGRESS" && step.availableFrom && Number.isFinite(new Date(step.availableFrom).getTime()) && new Date(now) < new Date(step.availableFrom)) throw new ValidationError("This Workflow step is not available yet.");
  if (state === "SKIPPED" && step.required !== false) throw new ValidationError("Required Workflow steps cannot be skipped.");
  if (state === "SKIPPED" && allowSkip !== true) throw new ValidationError("Skipping this Workflow step is not allowed.");
  if (state === "SKIPPED" && step.requireSkipReason && !String(reason || "").trim()) throw new ValidationError("A skip reason is required.");
  if (state === "EXCUSED" && allowExcuse !== true) throw new ValidationError("Excusing this Workflow step is not allowed.");
  if (state === "NOT_APPLICABLE" && allowNotApplicable !== true) throw new ValidationError("Marking this Workflow step not applicable is not allowed.");
  if (state === "BLOCKED" && !String(reason || "").trim()) throw new ValidationError("Blocked steps require a reason.");
  const terminal = WORKFLOW_TERMINAL_STEP_STATES.includes(state);
  return { ...step, state, reason: reason || null, resolvedAt: terminal ? new Date(now).toISOString() : step.resolvedAt || null, blockedAt: state === "BLOCKED" ? new Date(now).toISOString() : step.blockedAt || null };
}

export function transitionWorkflowStep({ run, stepId, state, reason = null, now = new Date() } = {}) {
  if (!run || !Array.isArray(run.steps)) throw new ValidationError("Workflow Run has no runtime steps.");
  const index = run.steps.findIndex((step) => step.id === stepId); if (index < 0) throw new ValidationError("Workflow step does not exist.");
  const before = run.steps[index]; const nextStep = resolveWorkflowStep({ step: before, state, reason, now }); const steps = run.steps.map((step, current) => current === index ? nextStep : step);
  if (["COMPLETED", "EXCUSED", "NOT_APPLICABLE"].includes(state)) {
    const unlockable = steps.filter((step) => step.state === "LOCKED" && (step.predecessorId === before.id || (step.predecessorId == null && step.position === before.position + 1)));
    for (const next of unlockable) {
      const nextIndex = steps.findIndex((step) => step.id === next.id);
      const mode = next.availabilityMode || next.timing?.availabilityMode || "immediate";
      let availableFrom = next.availableFrom || null;
      let nextState = "AVAILABLE";
      if (mode === "manual") nextState = "LOCKED";
      else if (mode === "delay") {
        availableFrom = addWorkflowDelay(new Date(now).toISOString(), next.delayValue, next.delayUnit);
        nextState = new Date(now) >= new Date(availableFrom) ? "AVAILABLE" : "LOCKED";
      } else if (mode === "specific" && availableFrom && new Date(now) < new Date(availableFrom)) nextState = "LOCKED";
      steps[nextIndex] = { ...next, state: nextState, availableFrom };
    }
  }
  const stamp = new Date(now).toISOString(); const transitions = [...(run.transitions || []), { type: "STEP_STATE", stepId, from: before.state, to: state, reason: reason || null, at: stamp }];
  const currentStepId = steps.find((step) => ["AVAILABLE", "IN_PROGRESS", "BLOCKED", "OVERDUE"].includes(step.state))?.id || null;
  return { ...run, steps, currentStepId, transitions, runtime: { ...(run.runtime || {}), type: "workflow", currentStepId, transitions: clone(transitions), updatedAt: stamp }, updatedAt: stamp };
}

export function evaluateWorkflowRun({ run, workflow = null, now = new Date(), finished = false } = {}) {
  const current = new Date(now); const config = workflowConfig(workflow || run?.snapshot?.block || run?.snapshot || {});
  const existingSteps = run?.steps || [];
  const steps = existingSteps.map((step) => {
    if (WORKFLOW_TERMINAL_STEP_STATES.includes(step.state)) return { ...step };
    const predecessor = existingSteps.find((candidate) => candidate.id === step.predecessorId);
    let next = { ...step };
    const predecessorSatisfied = !predecessor || isWorkflowStepSatisfied(predecessor);
    if (next.state === "LOCKED" && predecessorSatisfied && next.availabilityMode !== "manual" && (!next.availableFrom || current >= new Date(next.availableFrom))) next.state = "AVAILABLE";
    if (next.deadline && current >= new Date(next.deadline)) next = { ...next, state: "OVERDUE", overdueAt: next.overdueAt || current.toISOString() };
    return next;
  });
  const completion = resolveWorkflowCompletion({ steps }); const deadlineReached = Boolean(run?.deadline && current >= new Date(run.deadline));
  const status = finished && completion.satisfied ? "COMPLETED" : completion.satisfied ? (config.finishBehaviour === "confirm" || config.finishBehaviour === "ready" ? "READY_TO_FINISH" : "COMPLETED") : steps.some((step) => step.state === "OVERDUE") || deadlineReached ? "OVERDUE" : (steps.some((step) => ["IN_PROGRESS", "COMPLETED", "EXCUSED", "NOT_APPLICABLE"].includes(step.state)) ? "IN_PROGRESS" : "NOT_STARTED");
  return { ...completion, steps, status, deadlineReached, currentStepId: steps.find((step) => ["AVAILABLE", "IN_PROGRESS", "BLOCKED", "OVERDUE"].includes(step.state))?.id || null };
}
