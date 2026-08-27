import { deepClone } from "../shared/validation.js";

export const STATE_KEY = "life-command-v1-state";
export const FALLBACK_KEY = "life-command-v1-fallback";
export const RECOVERY_KEY = "life-command-v1-recovery";
export const ENGINE_BACKUP_KEY = "life-command-engine-v2-pre-migration";

export function migrationBackupKey(targetVersion = 2) {
  return Number(targetVersion) === 2 ? ENGINE_BACKUP_KEY : `life-command-engine-v${Number(targetVersion)}-pre-migration`;
}

export function parseStoredState(raw) {
  if (!raw) return null;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

export function readLocalCandidates(storage) {
  if (!storage) return [];
  const output = [];
  for (const key of [STATE_KEY, FALLBACK_KEY, RECOVERY_KEY]) {
    try {
      const value = parseStoredState(storage.getItem(key));
      if (value) output.push({ source: `localStorage:${key}`, value });
    } catch { /* Browser privacy modes may block localStorage. */ }
  }
  return output;
}

export function writeLocalState(storage, next, previous = null) {
  if (!storage) return;
  const serialized = JSON.stringify(next);
  const previousSerialized = previous ? JSON.stringify(previous) : storage.getItem(STATE_KEY) || storage.getItem(FALLBACK_KEY);
  if (previousSerialized && previousSerialized !== serialized) storage.setItem(RECOVERY_KEY, previousSerialized);
  storage.setItem(FALLBACK_KEY, serialized);
  storage.setItem(STATE_KEY, serialized);
}

export function writeLocalMigrationBackup(storage, state, key = ENGINE_BACKUP_KEY) {
  if (!storage || !state) return;
  if (storage.getItem(key) == null) storage.setItem(key, JSON.stringify(deepClone(state)));
}
