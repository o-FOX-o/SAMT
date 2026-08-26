import { deepClone } from "../shared/validation.js";

export function createBackupRecord(state, { id, now, reason, packageId = null }) {
  return {
    id,
    name: reason,
    reason,
    packageId,
    createdAt: now,
    snapshot: deepClone(state)
  };
}
