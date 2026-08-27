import { createId } from "../shared/ids.js";
import { ValidationError } from "../shared/errors.js";
import { calculatePeriodBounds } from "../shared/dates.js";
import { clone } from "../shared/validation.js";

export function createPeriod({ id = null, ownerId, period = "day", at, timezone = "UTC", weekStartsOn = 1, style = "calendar", customStart = null, customEnd = null, status = "open", snapshot = {}, now = new Date() } = {}) {
  if (!ownerId) throw new ValidationError("Period requires an owner.");
  const bounds = calculatePeriodBounds({ period, style, at, timezone, weekStartsOn, customStart, customEnd });
  return { id: id || createId("period", now), ownerId, period, style, timezone, weekStartsOn, start: bounds.start, end: bounds.end, key: bounds.key, status, snapshot: clone(snapshot) || {}, openedAt: new Date(now).toISOString(), closedAt: null, evaluation: null };
}

export function closePeriod(period, evaluation, closedAt = new Date()) {
  if (period.status === "closed") return period;
  return { ...period, status: "closed", closedAt: new Date(closedAt).toISOString(), evaluation: clone(evaluation) };
}

export function isPeriodClosed(period, now = new Date()) { return period.status === "closed" || Boolean(period.end && new Date(now) >= new Date(period.end)); }
