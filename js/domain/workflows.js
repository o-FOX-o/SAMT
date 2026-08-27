import { ValidationError } from "../shared/errors.js";

export const WORKFLOW_STEP_STATES = ["LOCKED", "AVAILABLE", "IN_PROGRESS", "COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "OVERDUE", "BLOCKED", "CANCELLED"];

export function nextWorkflowStep({ steps = [], currentStepId = null } = {}) {
  const index = currentStepId == null ? -1 : steps.findIndex((step) => step.id === currentStepId);
  return steps.slice(index + 1).find((step) => !["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "CANCELLED"].includes(step.state)) || null;
}

export function resolveWorkflowCompletion({ steps = [] } = {}) {
  const required = steps.filter((step) => step.required !== false); const satisfied = required.every((step) => ["COMPLETED", "EXCUSED", "NOT_APPLICABLE"].includes(step.state));
  return { satisfied, terminal: satisfied && steps.every((step) => !["LOCKED", "AVAILABLE", "IN_PROGRESS", "BLOCKED"].includes(step.state)) };
}

export function returnToWorkflowStep({ steps = [], stepId, now = new Date() } = {}) {
  const index = steps.findIndex((step) => step.id === stepId); if (index < 0) throw new ValidationError("Workflow step does not exist.");
  const reopenedAt = new Date(now).toISOString();
  return steps.map((step, current) => {
    if (current < index) return step;
    // Returning is an explicit runtime transition. Downstream steps are
    // reopened/locked even when they were previously completed; their old
    // factual completion remains in the Run history and is never deleted.
    return {
      ...step,
      state: current === index ? "AVAILABLE" : "LOCKED",
      reopenedAt,
      reopenedFromState: step.state
    };
  });
}

export function createWorkflowStep({ id, relationshipId = null, name = "", required = true, state = "LOCKED", position = 0, timing = null } = {}) {
  if (!id || !String(name || "").trim()) throw new ValidationError("Workflow step requires an ID and name.");
  if (!WORKFLOW_STEP_STATES.includes(state)) throw new ValidationError("Workflow step state is invalid.");
  return { id, relationshipId, name: String(name).trim(), required: required !== false, state, position: Math.max(0, Number(position) || 0), timing };
}

export function resolveWorkflowStep({ step, state, reason = null, now = new Date() } = {}) {
  if (!step || !WORKFLOW_STEP_STATES.includes(state)) throw new ValidationError("Workflow step resolution is invalid.");
  if (state === "BLOCKED" && !String(reason || "").trim()) throw new ValidationError("Blocked steps require a reason.");
  return { ...step, state, reason: reason || null, resolvedAt: ["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "CANCELLED"].includes(state) ? new Date(now).toISOString() : step.resolvedAt || null };
}
