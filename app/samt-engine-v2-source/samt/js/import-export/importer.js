import { ImportError } from "../shared/errors.js";
import { deepClone } from "../shared/validation.js";
import { planImportConflicts, applyConflictPlan } from "./conflicts.js";
import { migrateInternalState } from "./migrations.js";
import { validatePackage, validateState } from "./validator.js";

export function prepareImport(state, input) {
  const parsed = typeof input === "string" ? (() => { try { return JSON.parse(input); } catch { throw new ImportError("INVALID JSON FILE"); } })() : input;
  const { package: pkg } = validatePackage(parsed);
  if (pkg.packageType === "backup") {
    const migrated = migrateInternalState({ schemaVersion: state.schemaVersion, appVersion: state.appVersion, ...deepClone(pkg.data) }, { now: pkg.exportedAt, timezone: state.settings?.timezone || "Europe/London" }).state;
    validateState(migrated);
    return { package: pkg, isBackup: true, plan: [], candidate: migrated };
  }
  const plan = planImportConflicts(state, pkg);
  const candidate = applyConflictPlan(state, pkg, plan).state;
  validateState(candidate);
  return { package: pkg, isBackup: false, plan, candidate };
}

export function rebuildImportCandidate(state, preview) {
  if (preview.isBackup) return prepareImport(state, preview.package).candidate;
  const { package: pkg } = validatePackage(preview.package);
  const plan = planImportConflicts(state, pkg);
  const candidate = applyConflictPlan(state, pkg, plan).state;
  validateState(candidate);
  return candidate;
}
