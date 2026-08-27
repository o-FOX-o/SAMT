import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { requireName } from "../shared/validation.js";
import { finiteNumber } from "../shared/numbers.js";

export const BUILTIN_UNITS = [
  ["kg", "kg", "mass", 1], ["g", "g", "mass", 0.001], ["lb", "lb", "mass", 0.45359237],
  ["mm", "mm", "distance", 0.001], ["cm", "cm", "distance", 0.01], ["m", "m", "distance", 1], ["km", "km", "distance", 1000], ["mile", "mi", "distance", 1609.344],
  ["ml", "ml", "volume", 0.001], ["l", "l", "volume", 1],
  ["seconds", "s", "time", 1], ["minutes", "min", "time", 60], ["hours", "h", "time", 3600],
  ["kcal", "kcal", "energy", 1], ["pages", "pages", "count:pages", 1], ["reps", "reps", "count:reps", 1], ["sets", "sets", "count:sets", 1], ["steps", "steps", "count:steps", 1], ["bpm", "bpm", "rate:bpm", 1]
].map(([id, symbol, dimension, factor]) => ({ id: `unit_${id}`, name: id, symbol, dimension, baseUnitId: `unit_${dimension.split(":")[0] === "count" ? id : dimension === "mass" ? "kg" : dimension === "distance" ? "m" : dimension === "volume" ? "l" : dimension === "time" ? "seconds" : id}`, factor, decimalPrecision: dimension === "mass" || dimension === "distance" ? 2 : 0, status: "active", builtIn: true }));

export function createUnit({ id = null, name, symbol, dimension, baseUnitId = null, factor = 1, decimalPrecision = 2, status = "active", now = new Date() } = {}) {
  if (!dimension || typeof dimension !== "string") throw new ValidationError("Unit dimension is required.");
  if (!Number.isFinite(Number(factor)) || Number(factor) <= 0) throw new ValidationError("Unit conversion factor must be positive.");
  if (!Number.isInteger(Number(decimalPrecision)) || Number(decimalPrecision) < 0 || Number(decimalPrecision) > 10) throw new ValidationError("Unit precision is invalid.");
  if (!["active", "archived"].includes(status)) throw new ValidationError("Unit status is invalid.");
  const stamp = new Date(now).toISOString();
  return { id: id || createId("unit", now), name: requireName(name, "Unit name"), symbol: requireName(symbol || name, "Unit symbol"), dimension, baseUnitId: baseUnitId || null, factor: Number(factor), decimalPrecision: Number(decimalPrecision), status, builtIn: false, createdAt: stamp, updatedAt: stamp };
}

export function unitMap(units = []) { return new Map([...BUILTIN_UNITS, ...units].map((unit) => [unit.id, unit])); }
export function validateUnits(units = []) {
  const ids = new Set(); const names = new Set(); const symbols = new Set(); const builtins = new Map(BUILTIN_UNITS.map((unit) => [unit.id, unit])); const map = unitMap(units);
  for (const unit of units) {
    if (!unit?.id || ids.has(unit.id) || builtins.has(unit.id) && !unit.builtIn) throw new ValidationError("Unit IDs must be stable and unique.");
    if (!unit.name || names.has(String(unit.name).toLocaleLowerCase()) || symbols.has(String(unit.symbol).toLocaleLowerCase())) throw new ValidationError("Unit names and symbols must be unique.");
    if (!Number.isFinite(Number(unit.factor)) || Number(unit.factor) <= 0) throw new ValidationError("Unit conversion factor must be positive.");
    ids.add(unit.id); names.add(String(unit.name).toLocaleLowerCase()); symbols.add(String(unit.symbol).toLocaleLowerCase());
    if (unit.baseUnitId && !map.has(unit.baseUnitId)) throw new ValidationError(`Unit ${unit.id} references a missing base Unit.`);
    if (unit.baseUnitId && map.get(unit.baseUnitId).dimension !== unit.dimension) throw new ValidationError(`Unit ${unit.id} has an incompatible base Unit.`);
  }
  return true;
}
export function isCompatible(left, right, units = []) {
  const map = unitMap(units); const a = map.get(left?.id || left); const b = map.get(right?.id || right);
  return Boolean(a && b && a.dimension === b.dimension);
}
export function convertValue(value, from, to, units = []) {
  const map = unitMap(units); const source = map.get(from?.id || from); const target = map.get(to?.id || to);
  if (!source || !target || source.dimension !== target.dimension) throw new ValidationError("Units are not compatible.");
  return finiteNumber(value) * source.factor / target.factor;
}
export function roundToUnit(value, unit) {
  const precision = Math.max(0, Number(unit?.decimalPrecision ?? 2)); const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}
