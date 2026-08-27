import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { ValidationError } from "../shared/errors.js";

export const RUN_STATES = ["NOT_STARTED", "IN_PROGRESS", "PAUSED", "COMPLETED", "PARTIAL", "MISSED", "OVERDUE", "CANCELLED"];

export function createRun({ id = null, blockId, activationId = null, label = "", snapshot = {}, status = "NOT_STARTED", now = new Date() } = {}) { if (!blockId) throw new ValidationError("Run requires a Block."); if (!RUN_STATES.includes(status)) throw new ValidationError("Run status is invalid."); const stamp = new Date(now).toISOString(); return { id: id || createId("run", now), blockId, activationId, label: String(label || ""), status, snapshot: clone(snapshot) || {}, startedAt: null, pausedAt: null, finishedAt: null, createdAt: stamp, updatedAt: stamp }; }
export function startRun(run, now = new Date()) { if (!run) throw new ValidationError("Run is required."); return { ...run, status: "IN_PROGRESS", startedAt: run.startedAt || new Date(now).toISOString(), pausedAt: null, updatedAt: new Date(now).toISOString() }; }
export function finishRun(run, status = "COMPLETED", now = new Date()) { if (!RUN_STATES.includes(status) || ["NOT_STARTED", "IN_PROGRESS", "PAUSED"].includes(status)) throw new ValidationError("Finished Run status is invalid."); return { ...run, status, finishedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }; }
export function pauseRun(run, now = new Date()) { if (!run || run.status !== "IN_PROGRESS") return run; return { ...run, status: "PAUSED", pausedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }; }
export function resumeRun(run, now = new Date()) { if (!run || run.status !== "PAUSED") return run; return { ...run, status: "IN_PROGRESS", pausedAt: null, updatedAt: new Date(now).toISOString() }; }
export function cancelRun(run, now = new Date()) { return finishRun(run, "CANCELLED", now); }
