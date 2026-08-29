import { clone } from "../shared/validation.js";

export function createBackup(state, { exportedAt = new Date(), packageVersion = "3.0.0", packageType = "backup", packageId = null } = {}) { const stamp = new Date(exportedAt).toISOString(); return { package: "SAMT", schemaVersion: packageVersion, packageType, packageId: packageId || `samt_${packageType}_${stamp.replace(/[^0-9]/g, "").slice(0, 14)}`, exportedAt: stamp, state: clone(state) }; }
export function restoreBackup(backup) { return clone(backup?.state || backup); }
