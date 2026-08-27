import { ValidationError } from "./errors.js";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizedKey(value) { return normalizeName(value).toLocaleLowerCase(); }

export function requireName(value, label = "Name") {
  const name = normalizeName(value);
  if (!name) throw new ValidationError(`${label} is required.`);
  return name;
}

export function assertArray(value, label) {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array.`);
  return value;
}

export function assertUnique(values, key = (value) => value, label = "Value") {
  const seen = new Set();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) throw new ValidationError(`Duplicate ${label}: ${identity}`);
    seen.add(identity);
  }
  return true;
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function timestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ValidationError("Invalid timestamp.");
  return date.toISOString();
}
