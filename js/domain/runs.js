import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";

export const RUN_STATES = ["NOT_STARTED", "IN_PROGRESS", "PAUSED", "COMPLETED", "PARTIAL", "MISSED", "OVERDUE", "CANCELLED"];

export function createRun({ id = null, blockId, activationId = null, label = "", snapshot = {}, status = "NOT_STARTED", now = new Date() } = {}) { const stamp = new Date(now).toISOString(); return { id: id || createId("run", now), blockId, activationId, label, status, snapshot: clone(snapshot) || {}, startedAt: null, finishedAt: null, createdAt: stamp, updatedAt: stamp }; }
export function startRun(run, now = new Date()) { return { ...run, status: "IN_PROGRESS", startedAt: run.startedAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }; }
export function finishRun(run, status = "COMPLETED", now = new Date()) { return { ...run, status, finishedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }; }
