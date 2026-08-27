import { createId } from "../shared/ids.js";
import { ValidationError } from "../shared/errors.js";
import { clone } from "../shared/validation.js";

export function createActivation({ id = null, blockId, mode = "manual", recurrence = null, status = "active", now = new Date() } = {}) {
  if (!blockId) throw new ValidationError("Activation requires a Block.");
  if (!["manual", "run_now", "schedule"].includes(mode)) throw new ValidationError("Activation mode is invalid.");
  if (!["active", "paused", "archived"].includes(status)) throw new ValidationError("Activation status is invalid.");
  const stamp = new Date(now).toISOString(); return { id: id || createId("activation", now), blockId, mode, recurrence: clone(recurrence), status, startedAt: stamp, pausedAt: null, returnAt: null, createdAt: stamp, updatedAt: stamp };
}

export function pauseActivation(activation, { returnAt = null, now = new Date() } = {}) { return { ...activation, status: "paused", pausedAt: new Date(now).toISOString(), returnAt, updatedAt: new Date(now).toISOString() }; }
export function resumeActivation(activation, now = new Date()) { return { ...activation, status: "active", pausedAt: null, returnAt: null, updatedAt: new Date(now).toISOString() }; }
