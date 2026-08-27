import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { finiteNumber, nonNegative } from "../shared/numbers.js";
import { snapshotActionForLog } from "./actions.js";
import { snapshotResultValue, validateResultValues } from "./results.js";

export function createActionLog({ id = null, action, eventAt, durationMinutes = 0, quantity = null, resultValues = [], contextRefs = [], note = "", units = [], finalizing = false, now = new Date() } = {}) {
  if (!action?.id) throw new ValidationError("Action Log requires an Action.");
  const event = new Date(eventAt || now); if (!Number.isFinite(event.getTime())) throw new ValidationError("Action Log timestamp is invalid.");
  if (nonNegative(durationMinutes) !== Number(durationMinutes)) throw new ValidationError("Action Log duration cannot be negative.");
  if (quantity != null && (!Number.isFinite(Number(quantity)) || Number(quantity) < 0)) throw new ValidationError("Action Log quantity cannot be negative.");
  if (!Array.isArray(contextRefs) || contextRefs.some((reference) => !reference || typeof reference !== "object")) throw new ValidationError("Action Log context references are invalid.");
  const contextKeys = new Set(); for (const reference of contextRefs) { if (!reference.blockId && !reference.runId && !reference.occurrenceId) throw new ValidationError("Action Log context references need a Block, Run or Occurrence ID."); const key = `${reference.blockId || ""}:${reference.runId || ""}:${reference.occurrenceId || ""}`; if (contextKeys.has(key)) throw new ValidationError("Action Log context references must be unique."); contextKeys.add(key); }
  const values = (resultValues || []).map((entry) => {
    const field = (action.resultFields || []).find((candidate) => candidate.id === entry.fieldId);
    if (!field) throw new ValidationError("Result value references an unknown Result Field.");
    return { ...clone(entry), snapshot: entry.snapshot || snapshotResultValue(field, entry.value, units) };
  });
  validateResultValues({ fields: action.resultFields || [], resultValues: values, units, finalizing });
  return { id: id || createId("log", now), actionId: action.id, eventAt: event.toISOString(), durationMinutes: nonNegative(durationMinutes), quantity: quantity == null ? null : nonNegative(quantity), resultValues: values, contextRefs: clone(contextRefs) || [], note: String(note || ""), actionSnapshot: snapshotActionForLog(action), createdAt: new Date(now).toISOString() };
}

export function validateActionLog(log) {
  if (!log?.id || !log.actionId || !Number.isFinite(Number(log.durationMinutes)) || Number(log.durationMinutes) < 0 || log.quantity != null && (!Number.isFinite(Number(log.quantity)) || Number(log.quantity) < 0) || !Number.isFinite(new Date(log.eventAt).getTime())) throw new ValidationError("Action Log is invalid.");
  return true;
}

export function aggregateLogsUnique(logs = [], filter = null) {
  const seen = new Set(); return logs.filter((log) => (!filter || filter(log)) && !seen.has(log.id) && seen.add(log.id));
}
export function totalDuration(logs = [], filter = null) { return aggregateLogsUnique(logs, filter).reduce((sum, log) => sum + finiteNumber(log.durationMinutes), 0); }
export function totalQuantity(logs = [], filter = null) { return aggregateLogsUnique(logs, filter).reduce((sum, log) => sum + finiteNumber(log.quantity), 0); }
