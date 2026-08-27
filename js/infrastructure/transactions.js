import { clone } from "../shared/validation.js";
import { StorageError } from "../shared/errors.js";

export function atomicUpdate(repository, callback) {
  const before = clone(repository.getState());
  try { const value = callback(repository); repository.persist?.(); return value; }
  catch (error) { repository.replaceState(before, { persist: false }); throw error instanceof Error ? error : new StorageError(String(error)); }
}
