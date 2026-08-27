import { createRepository } from "./repository.js";
import { clone } from "../shared/validation.js";
import { normalizeState } from "../application/normalization.js";

export const V3_STORAGE_KEY = "life-command-progress-tracker-v3";
export const LEGACY_STORAGE_KEYS = ["life-command-progress-tracker-v2", "life-command-progress-tracker-v1"];

export function createBrowserRepository({ storage = undefined, key = V3_STORAGE_KEY, legacyKeys = LEGACY_STORAGE_KEYS, clock = new Date() } = {}) {
  let resolvedStorage = storage; let storageAvailable = false; let initial = null;
  if (resolvedStorage === undefined) {
    try { resolvedStorage = globalThis.localStorage; } catch { resolvedStorage = null; }
  }
  storageAvailable = Boolean(resolvedStorage);
  try {
    const raw = resolvedStorage?.getItem(key);
    if (raw) initial = normalizeState(JSON.parse(raw), { now: clock });
    if (!initial) for (const legacyKey of legacyKeys) { const legacyRaw = resolvedStorage?.getItem(legacyKey); if (legacyRaw) { initial = normalizeState(JSON.parse(legacyRaw), { now: clock }); break; } }
  } catch { storageAvailable = false; }
  const fallback = normalizeState(initial || {}, { now: clock });
  const persist = (state) => { if (!resolvedStorage) { storageAvailable = false; return false; } try { resolvedStorage.setItem(key, JSON.stringify(state)); storageAvailable = true; return true; } catch { storageAvailable = false; return false; } };
  const repository = createRepository({ state: fallback, persist }); repository.storageAvailable = () => storageAvailable; repository.storageKey = key; repository.legacyKeys = [...legacyKeys]; repository.inMemoryFallback = () => !storageAvailable; return repository;
}

export function readStorageState(storage, key = V3_STORAGE_KEY) { try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
