import { ConflictError } from "../shared/errors.js";

export const RUNNING_RUN_STATUSES = ["running", "active"];

export function createRun({ id, block, activation, now, snapshot }) {
  return { id, blockId: block.id, blockNameSnapshot: block.name, activationId: activation?.id || null, startAt: now, endAt: null, status: "running", progress: {}, childOccurrenceState: [], actionLogIds: [], results: [], notes: "", activationConfigurationSnapshot: activation ? structuredClone(activation) : null, structureSnapshot: snapshot, completionRulesSnapshot: structuredClone(block.completion || {}), createdAt: now, updatedAt: now };
}

export function assertNoRunningRun(runs, blockId) {
  const run = (runs || []).find((item) => item.blockId === blockId && RUNNING_RUN_STATUSES.includes(item.status));
  if (run) throw new ConflictError("This Block already has a running Run.", { runId: run.id });
  return true;
}

export function finishRun(run, now, status = "completed") { return { ...run, endAt: now, status, updatedAt: now }; }
export function pauseRun(run, now, resumeAt) { return { ...run, status: "paused", pausedAt: now, resumeAt, updatedAt: now }; }
export function resumeRun(run, now) { return { ...run, status: "running", resumedAt: now, pausedAt: null, resumeAt: null, updatedAt: now }; }
