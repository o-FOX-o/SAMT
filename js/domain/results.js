import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone, normalizeName, requireName, assertUnique } from "../shared/validation.js";
import { clamp, finiteNumber } from "../shared/numbers.js";
import { convertValue, isCompatible, unitMap } from "./units.js";

export const RESULT_TYPES = ["percentage", "score", "measurement", "text", "choice"];

export function createResultField({ id = null, definitionVersion = 1, type, label, helpText = "", required = false, position = 0, resultTagId = null, showInSummary = true, includeInAnalysis = true, config = {}, now = new Date() } = {}) {
  if (!RESULT_TYPES.includes(type)) throw new ValidationError("Result type is invalid.");
  const stamp = new Date(now).toISOString();
  const field = { id: id || createId("result", now), definitionVersion: Math.max(1, Number(definitionVersion) || 1), type, label: requireName(label, "Result label"), helpText: String(helpText || ""), required: Boolean(required), position: Math.max(0, Number(position) || 0), resultTagId, showInSummary: Boolean(showInSummary), includeInAnalysis: Boolean(includeInAnalysis), config: clone(config) || {}, createdAt: stamp, updatedAt: stamp };
  field.config = normalizeResultConfig(field);
  return field;
}

export function normalizeResultConfig(field) {
  const config = clone(field.config) || {};
  if (field.type === "percentage") return { decimal: Boolean(config.decimal) };
  if (field.type === "score") return { maximum: Math.max(0, finiteNumber(config.maximum, 100)), decimal: Boolean(config.decimal) };
  if (field.type === "measurement") return { defaultUnitId: config.defaultUnitId || null, allowedUnitIds: Array.isArray(config.allowedUnitIds) ? [...new Set(config.allowedUnitIds)] : [], min: config.min == null ? null : finiteNumber(config.min), max: config.max == null ? null : finiteNumber(config.max), decimal: config.decimal !== false };
  if (field.type === "text") return { multiline: Boolean(config.multiline), displaySize: ["small", "medium", "large"].includes(config.displaySize) ? config.displaySize : "medium", placeholder: String(config.placeholder || ""), minChars: Math.max(0, Number(config.minChars) || 0), maxChars: Math.max(0, Number(config.maxChars) || 2000) };
  return { mode: config.mode === "multiple" ? "multiple" : "single", options: Array.isArray(config.options) ? config.options.map((option, index) => ({ id: option.id || `option_${index + 1}`, label: requireName(option.label, "Choice option"), position: Number.isFinite(Number(option.position)) ? Number(option.position) : index, analysisScore: option.analysisScore == null ? null : finiteNumber(option.analysisScore) })) : [], minSelections: Math.max(0, Number(config.minSelections) || 0), maxSelections: config.maxSelections == null ? null : Math.max(0, Number(config.maxSelections)), orderMatters: Boolean(config.orderMatters), betterDirection: ["higher", "lower", "none"].includes(config.betterDirection) ? config.betterDirection : "none" };
}

export function validateResultFields(fields = [], units = []) {
  if (!Array.isArray(fields) || fields.length > 10) throw new ValidationError("An Action may have 0 to 10 Result Fields.");
  assertUnique(fields, (field) => field.id, "Result Field ID");
  const labels = new Set();
  for (const field of fields) {
    if (!RESULT_TYPES.includes(field.type)) throw new ValidationError("Result type is invalid.");
    const label = normalizeName(field.label).toLocaleLowerCase();
    if (!label || labels.has(label)) throw new ValidationError("Result labels must be unique within an Action.");
    labels.add(label);
    if (field.type === "measurement") {
      const config = normalizeResultConfig(field); const map = unitMap(units);
      if (config.defaultUnitId && !map.has(config.defaultUnitId)) throw new ValidationError("Measurement default Unit is missing.");
      if (config.allowedUnitIds.some((id) => !map.has(id) || config.defaultUnitId && !isCompatible(id, config.defaultUnitId, units))) throw new ValidationError("Measurement Units must be compatible.");
    }
    if (field.type === "choice") {
      const options = normalizeResultConfig(field).options; assertUnique(options, (option) => option.id, "Choice option ID");
    }
  }
  return true;
}

export function validateResultValues({ fields = [], resultValues = [], units = [], finalizing = true } = {}) {
  const byId = new Map(fields.map((field) => [field.id, field])); const seen = new Set();
  for (const entry of resultValues || []) {
    if (!byId.has(entry.fieldId)) throw new ValidationError("Result value references an unknown Result Field.");
    if (seen.has(entry.fieldId)) throw new ValidationError("A Result Field may have one value per Action Log.");
    seen.add(entry.fieldId); validateSingleValue(byId.get(entry.fieldId), entry.value, units);
  }
  if (finalizing) for (const field of fields) if (field.required && !seen.has(field.id)) throw new ValidationError(`Required Result missing: ${field.label}`);
  return true;
}

function validateSingleValue(field, value, units) {
  const config = normalizeResultConfig(field);
  if (field.type === "percentage") { if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw new ValidationError(`${field.label} must be between 0 and 100.`); return; }
  if (field.type === "score") { if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > config.maximum) throw new ValidationError(`${field.label} must be between 0 and ${config.maximum}.`); return; }
  if (field.type === "measurement") { const numeric = finiteNumber(value?.value, NaN); if (!Number.isFinite(numeric)) throw new ValidationError(`${field.label} requires a numeric value.`); const map = unitMap(units); const unit = map.get(value?.unitId || config.defaultUnitId); if (!unit) throw new ValidationError(`${field.label} requires a valid Unit.`); if (config.allowedUnitIds.length && !config.allowedUnitIds.includes(unit.id)) throw new ValidationError(`${field.label} Unit is not allowed.`); if (config.min != null && numeric < config.min || config.max != null && numeric > config.max) throw new ValidationError(`${field.label} is outside its allowed range.`); return; }
  if (field.type === "text") { if (typeof value !== "string") throw new ValidationError(`${field.label} must be text.`); if (value.length < config.minChars || value.length > config.maxChars) throw new ValidationError(`${field.label} has an invalid length.`); return; }
  const selected = config.mode === "multiple" ? (Array.isArray(value) ? value : []) : [value];
  if (config.mode === "multiple" && !Array.isArray(value)) throw new ValidationError(`${field.label} requires multiple selections.`);
  if (!selected.length && config.minSelections > 0) throw new ValidationError(`${field.label} requires a selection.`);
  if (config.maxSelections != null && selected.length > config.maxSelections) throw new ValidationError(`${field.label} has too many selections.`);
  const ids = new Set(config.options.map((option) => option.id)); if (selected.some((id) => !ids.has(id))) throw new ValidationError(`${field.label} contains an invalid choice.`);
}

export function snapshotResultValue(field, value, units = []) {
  const snapshot = { fieldId: field.id, fieldVersion: field.definitionVersion, fieldLabel: field.label, type: field.type, value: clone(value) };
  if (field.type === "measurement") { const unit = unitMap(units).get(value?.unitId || field.config.defaultUnitId); snapshot.unitId = unit?.id || null; snapshot.unitSymbol = unit?.symbol || null; }
  if (field.type === "score") snapshot.maximum = normalizeResultConfig(field).maximum;
  if (field.type === "choice") { const options = normalizeResultConfig(field).options; const ids = Array.isArray(value) ? value : [value]; snapshot.choiceSnapshots = ids.map((id) => options.find((option) => option.id === id)).filter(Boolean).map((option) => ({ id: option.id, label: option.label, position: option.position, analysisScore: option.analysisScore })); }
  return snapshot;
}

export function analyzeResultValues({ field, values = [], units = [], operation = null } = {}) {
  const config = normalizeResultConfig(field); const rows = values.filter((value) => value !== undefined && value !== null);
  if (!rows.length) return { count: 0, value: null, values: [] };
  if (field.type === "text") { const normalized = rows.map((value) => String(value)); const counts = Object.fromEntries([...new Set(normalized.map((value) => value.trim().toLocaleLowerCase()))].map((key) => [key, normalized.filter((value) => value.trim().toLocaleLowerCase() === key).length])); return { count: rows.length, value: normalized.at(-1), unique: Object.keys(counts).length, frequencies: counts, values: normalized }; }
  if (field.type === "choice") { const all = config.mode === "multiple" ? rows.flat() : rows; const frequencies = {}; for (const value of all) frequencies[value] = (frequencies[value] || 0) + 1; const scores = all.map((id) => config.options.find((option) => option.id === id)?.analysisScore).filter((score) => score != null); return { count: rows.length, value: rows.at(-1), frequencies, percentage: Object.fromEntries(Object.entries(frequencies).map(([key, count]) => [key, count / all.length * 100])), ordinalAverage: config.orderMatters ? all.map((id) => config.options.find((option) => option.id === id)?.position).filter(Number.isFinite).reduce((sum, value, _, array) => sum + value / array.length, 0) : null, numericAverage: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null }; }
  const numeric = field.type === "measurement" ? rows.map((entry) => entry.value) : rows.map(Number);
  if (field.type === "measurement" && operation === "total") return { count: rows.length, value: numeric.reduce((sum, value) => sum + value, 0) };
  const valuesSorted = [...numeric].sort((a, b) => a - b); const latest = numeric.at(-1); const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return { count: numeric.length, value: operation === "latest" ? latest : operation === "min" ? valuesSorted[0] : operation === "max" ? valuesSorted.at(-1) : average, latest, min: valuesSorted[0], max: valuesSorted.at(-1), average, change: latest - numeric[0] };
}

export function normalizeForTextAnalysis(value) { return String(value ?? "").trim().toLocaleLowerCase(); }
