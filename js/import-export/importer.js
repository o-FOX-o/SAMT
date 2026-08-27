import { ImportError } from "../shared/errors.js";
import { clone } from "../shared/validation.js";
import { normalizeState } from "../application/normalization.js";
import { validatePackage } from "./validator.js";

export function importPackage(packageValue, { existingState = null, now = new Date(), conflict = "replace" } = {}) {
  const raw = packageValue?.state || packageValue;
  // Schema-v2 exports were raw state objects rather than a V3 package
  // envelope. Normalize them before strict V3 validation so the old backup
  // remains a first-class import source without weakening V3 checks.
  const isLegacy = String(raw?.schemaVersion || "").startsWith("2.") || String(raw?.schemaVersion || "").startsWith("1.");
  if (!isLegacy) { const rawChecked = validatePackage(raw); if (!rawChecked.ok) throw rawChecked.error; }
  const candidate = normalizeState(raw, { now }); const checked = validatePackage(candidate); if (!checked.ok) throw checked.error;
  if (conflict === "preserve_existing" && existingState) return { state: mergePreservingExisting(existingState, candidate), restorePoint: clone(existingState) };
  return { state: clone(candidate), restorePoint: clone(existingState) };
}

function mergePreservingExisting(existing, incoming) {
  const result = clone(existing); for (const key of ["categories", "tags", "units", "actions", "blocks", "tasks", "quickTasks", "reviews", "activations", "runs", "occurrences", "periods", "actionLogs", "targetEvaluations", "cycleSmallCycles", "cycleBigCycles", "scopeChangeEvents", "lifecycleEvents", "history"]) { const rows = result[key] || []; const ids = new Set(rows.map((row) => row.id)); result[key] = [...rows, ...(incoming[key] || []).filter((row) => !ids.has(row.id))]; } return result;
}
