import { ConflictError } from "../shared/errors.js";

export const ACTIVE_ACTIVATION_STATUSES = ["active", "running", "scheduled", "manual", "paused", "waiting"];

export function assertOneActiveActivation(activations, blockId, exceptId = null) {
  const existing = (activations || []).find((item) => item.blockId === blockId && item.id !== exceptId && ACTIVE_ACTIVATION_STATUSES.includes(item.status));
  if (existing) throw new ConflictError("This Block already has an active Activation.", { activationId: existing.id, blockId });
  return true;
}

export function pauseActivation(activation, pausedAt, resumeAt) {
  return { ...activation, statusBeforePause: activation.status === "paused" ? activation.statusBeforePause : activation.status, status: "paused", pausedAt, resumeAt: resumeAt || null, updatedAt: pausedAt };
}

export function resumeActivation(activation, resumedAt) {
  return { ...activation, status: activation.statusBeforePause || "manual", statusBeforePause: null, pausedAt: null, resumeAt: null, resumedAt, updatedAt: resumedAt };
}
