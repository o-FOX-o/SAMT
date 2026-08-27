import { createRepository } from "./repository.js";
import { clone } from "../shared/validation.js";
import { createEmptyState, normalizeState } from "../application/normalization.js";
import { validatePackage } from "../import-export/validator.js";

export const V3_STORAGE_KEY = "life-command-progress-tracker-v3";
export const LEGACY_STORAGE_KEYS = ["life-command-progress-tracker-v2", "life-command-progress-tracker-v1"];
export const V3_BACKUP_KEY = "life-command-progress-tracker-v3-restore-point";

export function createBrowserRepository({ storage = undefined, key = V3_STORAGE_KEY, legacyKeys = LEGACY_STORAGE_KEYS, backupKey = V3_BACKUP_KEY, clock = new Date() } = {}) {
  let resolvedStorage = storage; let storageAvailable = false; let initial = null; let sourceState = null; let sourceKey = null; let migrationError = null;
  if (resolvedStorage === undefined) {
    try { resolvedStorage = globalThis.localStorage; } catch { resolvedStorage = null; }
  }
  storageAvailable = Boolean(resolvedStorage && typeof resolvedStorage.getItem === "function");
  let migratedFromLegacy = false;
  try {
    const raw = resolvedStorage?.getItem(key);
    if (raw) {
      try { sourceKey = key; sourceState = JSON.parse(raw); initial = normalizeState(sourceState, { now: clock }); }
      catch (error) { migrationError = error; initial = null; }
    }
    if (!initial) for (const legacyKey of legacyKeys) {
      let legacyRaw = null; try { legacyRaw = resolvedStorage?.getItem(legacyKey); } catch (error) { migrationError = error; }
      if (!legacyRaw) continue;
      try { sourceKey = legacyKey; sourceState = JSON.parse(legacyRaw); initial = normalizeState(sourceState, { now: clock }); migratedFromLegacy = true; break; }
      catch (error) { migrationError = error; }
    }
  } catch (error) { storageAvailable = false; migrationError = error; }
  if (!initial && sourceState == null && !migratedFromLegacy) initial = createEmptyState(clock);
  if (migratedFromLegacy && resolvedStorage) {
    try {
      // Keep the exact pre-migration payload available for recovery. The
      // normalised state is also included so an operator can inspect the
      // proposed V3 result without touching the V2/V1 source key.
      resolvedStorage.setItem(backupKey, JSON.stringify({ package: "SAMT", schemaVersion: "3.0.0-restore-point", createdAt: new Date(clock).toISOString(), sourceKey, sourceKeys: legacyKeys, originalState: clone(sourceState), state: clone(initial) }));
      const checked = validatePackage(initial);
      if (!checked.ok) throw checked.error;
      resolvedStorage.setItem(key, JSON.stringify(initial));
    } catch (error) {
      // Storage and migration errors are deliberately non-fatal. The legacy
      // source remains intact and the repository continues in memory.
      migrationError = error;
      storageAvailable = false;
    }
  }
  // A clean install is a true empty state; only an actual legacy payload is
  // sent through the V2/V1 mapper.
  const fallback = initial ? normalizeState(initial, { now: clock }) : createEmptyState(clock);
  const persist = (state) => { if (!resolvedStorage) { storageAvailable = false; return false; } try { resolvedStorage.setItem(key, JSON.stringify(state)); storageAvailable = true; return true; } catch { storageAvailable = false; return false; } };
  const repository = createRepository({ state: fallback, persist }); repository.storageAvailable = () => storageAvailable; repository.storageKey = key; repository.backupKey = backupKey; repository.legacyKeys = [...legacyKeys]; repository.restorePoint = migratedFromLegacy ? clone(initial) : null; repository.migrationError = migrationError; repository.migratedFromLegacy = migratedFromLegacy; repository.inMemoryFallback = () => !storageAvailable; return repository;
}

export function readStorageState(storage, key = V3_STORAGE_KEY) { try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
