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

export const MAX_NAME_LENGTH = 100;
export const MAX_UNIT_NAME_LENGTH = 40;

function normalizeDisplayText(value, maximumLength) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return [...normalized].slice(0, maximumLength).join("").trim();
}

export function normalizeName(value) {
  return normalizeDisplayText(value, MAX_NAME_LENGTH);
}

export function normalizedNameKey(value) {
  return normalizeName(value).toLocaleLowerCase();
}

export function normalizeUnitName(value) {
  return normalizeDisplayText(value, MAX_UNIT_NAME_LENGTH);
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
    const key = normalizedNameKey(normalized);
    if (names.has(key)) throw new ConflictError(`${kind} name already exists: ${normalized}`, { firstId: names.get(key), secondId: item.id });
    names.set(key, item.id);
  }
  return true;
}

export function result(value) { return { ok: true, value }; }
export function failure(error) { return { ok: false, error }; }
