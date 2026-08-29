import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { ValidationError } from "../shared/errors.js";

export const RUN_STATES = ["NOT_STARTED", "IN_PROGRESS", "READY_TO_FINISH", "PAUSED", "COMPLETED", "PARTIAL", "MISSED", "OVERDUE", "EXPIRED", "CANCELLED"];
export const RUN_TERMINAL_STATES = ["COMPLETED", "PARTIAL", "MISSED", "EXPIRED", "CANCELLED"];

export function isRunTerminal(runOrStatus) {
  const status = typeof runOrStatus === "string" ? runOrStatus : runOrStatus?.status;
  return RUN_TERMINAL_STATES.includes(status);
}

export function createRun({ id = null, blockId, activationId = null, label = "", snapshot = {}, status = "NOT_STARTED", runtime = null, children = [], steps = null, currentStepId = null, transitions = [], plannedStart = null, actualStart = null, deadline = null, scheduledAt = null, activationSnapshot = null, now = new Date() } = {}) {
  if (!blockId) throw new ValidationError("Run requires a Block.");
  if (!RUN_STATES.includes(status)) throw new ValidationError("Run status is invalid.");
  const stamp = new Date(now).toISOString();
  return { id: id || createId("run", now), blockId, activationId, label: String(label || ""), status, snapshot: clone(snapshot) || {}, runtime: clone(runtime), children: clone(children) || [], steps: steps == null ? null : clone(steps), currentStepId, transitions: clone(transitions) || [], plannedStart, actualStart, deadline, scheduledAt, activationSnapshot: clone(activationSnapshot), startedAt: null, pausedAt: null, finishedAt: null, createdAt: stamp, updatedAt: stamp };
}

export function startRun(run, now = new Date()) {
  if (!run) throw new ValidationError("Run is required.");
  if (isRunTerminal(run)) throw new ValidationError("A finished Run cannot be started again.");
  const stamp = new Date(now).toISOString();
  return { ...run, status: "IN_PROGRESS", startedAt: run.startedAt || stamp, actualStart: run.actualStart || stamp, pausedAt: null, updatedAt: stamp };
}

export function finishRun(run, status = "COMPLETED", now = new Date()) {
  if (!RUN_STATES.includes(status) || ["NOT_STARTED", "IN_PROGRESS", "PAUSED"].includes(status)) throw new ValidationError("Finished Run status is invalid.");
  if (!run) throw new ValidationError("Run is required.");
  const stamp = new Date(now).toISOString();
  return { ...run, status, finishedAt: run.finishedAt || stamp, updatedAt: stamp };
}

export function pauseRun(run, now = new Date()) {
  if (!run || !["IN_PROGRESS", "READY_TO_FINISH"].includes(run.status)) return run;
  const stamp = new Date(now).toISOString();
  return { ...run, status: "PAUSED", pausedAt: stamp, updatedAt: stamp };
}

export function resumeRun(run, now = new Date()) {
  if (!run || run.status !== "PAUSED") return run;
  return { ...run, status: "IN_PROGRESS", pausedAt: null, updatedAt: new Date(now).toISOString() };
}

export function cancelRun(run, now = new Date()) { return finishRun(run, "CANCELLED", now); }
export function appendRunTransition(run, transition = {}, now = new Date()) {
  if (!run) throw new ValidationError("Run is required.");
  const stamp = new Date(now).toISOString();
  return { ...run, transitions: [...(run.transitions || []), { ...clone(transition), at: transition.at || stamp }], updatedAt: stamp };
}
