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

export function returnToWorkflowStep({ steps = [], stepId } = {}) {
  const index = steps.findIndex((step) => step.id === stepId); if (index < 0) throw new ValidationError("Workflow step does not exist.");
  return steps.map((step, current) => current >= index && !["COMPLETED", "EXCUSED", "NOT_APPLICABLE"].includes(step.state) ? { ...step, state: current === index ? "AVAILABLE" : "LOCKED" } : step);
}
