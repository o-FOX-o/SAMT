import { clone } from "../shared/validation.js";

export function createBackup(state, { exportedAt = new Date(), packageVersion = "3.0.0" } = {}) { return { package: "SAMT", schemaVersion: packageVersion, exportedAt: new Date(exportedAt).toISOString(), state: clone(state) }; }
export function restoreBackup(backup) { return clone(backup?.state || backup); }
