import { createId } from "../shared/ids.js";
import { ValidationError } from "../shared/errors.js";
import { clone } from "../shared/validation.js";
import { validateActionListSchedule } from "./action-lists.js";

export const ACTIVATION_MODES = ["manual", "run_now", "schedule"];
export const ACTIVATION_STATUSES = ["active", "paused", "archived"];

function normalizeEnd({ endAt = null, endAfterRuns = null } = {}) {
  if (endAt != null && Number.isNaN(new Date(endAt).getTime())) throw new ValidationError("Activation end date is invalid.");
  if (endAfterRuns != null && (!Number.isInteger(Number(endAfterRuns)) || Number(endAfterRuns) < 1)) throw new ValidationError("Activation end run count is invalid.");
  return { endAt: endAt ? new Date(endAt).toISOString() : null, endAfterRuns: endAfterRuns == null ? null : Number(endAfterRuns) };
}

export function isActivationEnded(activation = {}, now = new Date()) {
  const end = normalizeEnd(activation);
  return Boolean((end.endAt && new Date(now) >= new Date(end.endAt)) || (end.endAfterRuns != null && Number(activation.runCount || 0) >= end.endAfterRuns));
}

export function createActivation({
  id = null,
  blockId,
  mode = "manual",
  recurrence = null,
  status = "active",
  label = "",
  endAt = null,
  endAfterRuns = null,
  runCount = 0,
  lastScheduledAt = null,
  now = new Date()
} = {}) {
  if (!blockId) throw new ValidationError("Activation requires a Block.");
  if (!ACTIVATION_MODES.includes(mode)) throw new ValidationError("Activation mode is invalid.");
  if (!ACTIVATION_STATUSES.includes(status)) throw new ValidationError("Activation status is invalid.");
  if (!Number.isInteger(Number(runCount)) || Number(runCount) < 0) throw new ValidationError("Activation run count is invalid.");
  if (mode === "schedule") {
    if (!recurrence || !["once", "interval", "calendar"].includes(recurrence.mode)) throw new ValidationError("Scheduled Activations require a once, interval or calendar recurrence.");
    validateActionListSchedule(recurrence);
  }
  const end = normalizeEnd({ endAt, endAfterRuns });
  const stamp = new Date(now).toISOString();
  return {
    id: id || createId("activation", now),
    blockId,
    mode,
    recurrence: clone(recurrence),
    status,
    label: String(label || ""),
    ...end,
    runCount: Number(runCount),
    lastScheduledAt: lastScheduledAt ? new Date(lastScheduledAt).toISOString() : null,
    startedAt: stamp,
    pausedAt: null,
    returnAt: null,
    createdAt: stamp,
    updatedAt: stamp
  };
}

export function pauseActivation(activation, { returnAt = null, now = new Date() } = {}) {
  return { ...activation, status: "paused", pausedAt: new Date(now).toISOString(), returnAt, updatedAt: new Date(now).toISOString() };
}

export function resumeActivation(activation, now = new Date()) {
  return { ...activation, status: "active", pausedAt: null, returnAt: null, updatedAt: new Date(now).toISOString() };
}

export function recordActivationRun(activation, now = new Date()) {
  const runCount = Number(activation?.runCount || 0) + 1;
  return { ...activation, runCount, lastScheduledAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}
