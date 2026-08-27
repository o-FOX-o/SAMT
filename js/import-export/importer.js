import { ImportError } from "../shared/errors.js";
import { clone } from "../shared/validation.js";
import { normalizeState } from "../application/normalization.js";
import { validatePackage } from "./validator.js";

export function importPackage(packageValue, { existingState = null, now = new Date(), conflict = "replace" } = {}) {
  const candidate = normalizeState(packageValue?.state || packageValue, { now }); const checked = validatePackage(candidate); if (!checked.ok) throw checked.error;
  if (conflict === "preserve_existing" && existingState) return { state: mergePreservingExisting(existingState, candidate), restorePoint: clone(existingState) };
  return { state: clone(candidate), restorePoint: clone(existingState) };
}

function mergePreservingExisting(existing, incoming) {
  const result = clone(existing); for (const key of ["categories", "tags", "units", "actions", "blocks", "activations", "runs", "occurrences", "periods", "actionLogs", "targetEvaluations", "cycleSmallCycles", "cycleBigCycles", "history"]) { const rows = result[key] || []; const ids = new Set(rows.map((row) => row.id)); result[key] = [...rows, ...(incoming[key] || []).filter((row) => !ids.has(row.id))]; } return result;
}
