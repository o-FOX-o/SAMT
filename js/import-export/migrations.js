import { normalizeState } from "../application/normalization.js";

export function migratePackage(packageValue, options = {}) { return normalizeState(packageValue?.state || packageValue, options); }
