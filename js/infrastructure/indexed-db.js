import { createRepository } from "./repository.js";
import { createEmptyState, normalizeState } from "../application/normalization.js";

/** Optional adapter boundary. The reference client uses localStorage first. */
export async function createIndexedDbRepository({ databaseName = "samt", storeName = "state", indexedDB = globalThis.indexedDB, now = new Date() } = {}) {
  if (!indexedDB) { const repository = createRepository({ state: createEmptyState(now), persist: () => false }); repository.storageAvailable = () => false; repository.inMemoryFallback = () => true; return repository; }
  try {
    const state = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const get = db.transaction(storeName, "readonly").objectStore(storeName).get("current"); get.onsuccess = () => { const value = get.result || createEmptyState(now); db.close(); resolve(normalizeState(value, { now })); }; get.onerror = () => { db.close(); reject(get.error); }; };
    });
    let available = true; const persist = (next) => { try { const request = indexedDB.open(databaseName, 1); request.onerror = () => { available = false; }; request.onsuccess = () => { const db = request.result; const put = db.transaction(storeName, "readwrite").objectStore(storeName).put(next, "current"); put.onerror = () => { available = false; db.close(); }; put.onsuccess = () => db.close(); }; return true; } catch { available = false; return false; } };
    const repository = createRepository({ state, persist }); repository.storageAvailable = () => available; repository.inMemoryFallback = () => !available; return repository;
  } catch {
    const repository = createRepository({ state: createEmptyState(now), persist: () => false }); repository.storageAvailable = () => false; repository.inMemoryFallback = () => true; return repository;
  }
}
