import { createRepository } from "./repository.js";
import { createEmptyState } from "../application/normalization.js";

/** Optional adapter boundary. The reference client uses localStorage first. */
export async function createIndexedDbRepository({ databaseName = "samt", storeName = "state", indexedDB = globalThis.indexedDB, now = new Date() } = {}) {
  if (!indexedDB) return createRepository({ state: createEmptyState(now), persist: () => true });
  const state = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const get = db.transaction(storeName, "readonly").objectStore(storeName).get("current"); get.onsuccess = () => { resolve(get.result || createEmptyState(now)); }; get.onerror = () => reject(get.error); };
  });
  return createRepository({ state, persist: (next) => { const db = indexedDB.open(databaseName); db.onsuccess = () => db.result.transaction(storeName, "readwrite").objectStore(storeName).put(next, "current"); } });
}
