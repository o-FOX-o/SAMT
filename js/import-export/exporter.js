import { createBackup } from "../infrastructure/backup.js";
import { clone } from "../shared/validation.js";

export function exportPackage(state, options = {}) { return createBackup(clone(state), { ...options, packageVersion: "3.0.0" }); }
export function serializePackage(state, options = {}) { return JSON.stringify(exportPackage(state, options), null, 2); }
