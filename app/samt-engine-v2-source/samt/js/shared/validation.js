import { ConflictError, ValidationError } from "./errors.js";

export function invariant(condition, message, details) {
  if (!condition) throw new ValidationError(message, details);
}

export function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function normalizeName(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase())
    .slice(0, 25)
    .trim();
}

export function normalizeUnitName(value) {
  return String(value || "").replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 15);
}

export function assertStableId(value, label = "Object") {
  invariant(typeof value === "string" && value.trim().length > 0, `${label} needs a stable ID.`);
  return value;
}

export function assertUniqueIds(collections) {
  const seen = new Map();
  for (const [kind, items] of Object.entries(collections)) {
    for (const item of items || []) {
      assertStableId(item && item.id, kind);
      if (seen.has(item.id)) throw new ConflictError(`Duplicate stable ID: ${item.id}`, { first: seen.get(item.id), second: kind });
      seen.set(item.id, kind);
    }
  }
  return true;
}

export function assertUniqueNormalizedNames(items, kind) {
  const names = new Map();
  for (const item of items || []) {
    const normalized = normalizeName(item.name);
    invariant(normalized.length > 0, `${kind} name is required.`, { id: item.id });
    const key = normalized.toLocaleLowerCase();
    if (names.has(key)) throw new ConflictError(`${kind} name already exists: ${normalized}`, { firstId: names.get(key), secondId: item.id });
    names.set(key, item.id);
  }
  return true;
}

export function result(value) { return { ok: true, value }; }
export function failure(error) { return { ok: false, error }; }
