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
  if (field.type === "text") return { multiline: Boolean(config.multiline), displaySize: ["small", "medium", "large"].includes(config.displaySize) ? config.displaySize : "medium", placeholder: String(config.placeholder || ""), minChars: Math.max(0, Number.isFinite(Number(config.minChars)) ? Number(config.minChars) : 0), maxChars: Math.max(0, Number.isFinite(Number(config.maxChars)) ? Number(config.maxChars) : 2000) };
  const options = Array.isArray(config.options) ? config.options.map((option, index) => ({ id: option.id || `option_${index + 1}`, label: requireName(option.label, "Choice option"), position: Number.isFinite(Number(option.position)) ? Number(option.position) : index, analysisScore: option.analysisScore == null ? null : finiteNumber(option.analysisScore) })) : [];
  return { mode: config.mode === "multiple" ? "multiple" : "single", options, minSelections: Math.max(0, Number.isFinite(Number(config.minSelections)) ? Number(config.minSelections) : 0), maxSelections: config.maxSelections == null ? null : Math.max(0, Number(config.maxSelections)), orderMatters: Boolean(config.orderMatters), betterDirection: ["higher", "lower", "none"].includes(config.betterDirection) ? config.betterDirection : "none" };
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
      if (config.min != null && config.max != null && config.min > config.max) throw new ValidationError(`${field.label} minimum cannot exceed maximum.`);
    }
    if (field.type === "text") { const config = normalizeResultConfig(field); if (config.maxChars < config.minChars) throw new ValidationError(`${field.label} text length limits are invalid.`); if (!config.multiline && String(config.placeholder || "").includes("\n")) throw new ValidationError(`${field.label} single-line fields cannot have a multiline placeholder.`); }
    if (field.type === "choice") {
      const config = normalizeResultConfig(field); const options = config.options; assertUnique(options, (option) => option.id, "Choice option ID"); assertUnique(options, (option) => option.position, "Choice option position");
      assertUnique(options, (option) => option.label.toLocaleLowerCase(), "Choice option label");
      if (config.maxSelections != null && config.maxSelections < config.minSelections) throw new ValidationError(`${field.label} selection limits are invalid.`);
      if (config.mode === "single" && (config.minSelections > 1 || config.maxSelections != null && config.maxSelections > 1)) throw new ValidationError(`${field.label} is single choice and allows one selection.`);
    }
  }
  return true;
}

export function validateResultValues({ fields = [], resultValues = [], units = [], finalizing = true } = {}) {
  const byId = new Map(fields.map((field) => [field.id, field])); const seen = new Set();
  for (const entry of resultValues || []) {
    if (!byId.has(entry.fieldId)) throw new ValidationError("Result value references an unknown Result Field.");
    if (seen.has(entry.fieldId)) throw new ValidationError("A Result Field may have one value per Action Log.");
    const field = byId.get(entry.fieldId); if (field.required && (entry.value == null || Array.isArray(entry.value) && entry.value.length === 0 || typeof entry.value === "string" && entry.value.length === 0)) throw new ValidationError(`Required Result missing: ${field.label}`);
    seen.add(entry.fieldId); validateSingleValue(field, entry.value, units);
  }
  if (finalizing) for (const field of fields) if (field.required && !seen.has(field.id)) throw new ValidationError(`Required Result missing: ${field.label}`);
  return true;
}

function validateSingleValue(field, value, units) {
  const config = normalizeResultConfig(field);
  if (field.type === "percentage") { if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw new ValidationError(`${field.label} must be between 0 and 100.`); return; }
  if (field.type === "score") { if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > config.maximum) throw new ValidationError(`${field.label} must be between 0 and ${config.maximum}.`); return; }
  if (field.type === "measurement") { const numeric = finiteNumber(value?.value, NaN); if (!Number.isFinite(numeric)) throw new ValidationError(`${field.label} requires a numeric value.`); const map = unitMap(units); const unit = map.get(value?.unitId || config.defaultUnitId); if (!unit) throw new ValidationError(`${field.label} requires a valid Unit.`); if (config.allowedUnitIds.length && !config.allowedUnitIds.includes(unit.id)) throw new ValidationError(`${field.label} Unit is not allowed.`); const comparable = config.defaultUnitId && unit.id !== config.defaultUnitId ? convertValue(numeric, unit.id, config.defaultUnitId, units) : numeric; if (config.min != null && comparable < config.min || config.max != null && comparable > config.max) throw new ValidationError(`${field.label} is outside its allowed range.`); return; }
  if (field.type === "text") { if (typeof value !== "string") throw new ValidationError(`${field.label} must be text.`); if (value.length < config.minChars || value.length > config.maxChars) throw new ValidationError(`${field.label} has an invalid length.`); return; }
  const selected = config.mode === "multiple" ? (Array.isArray(value) ? value : []) : [value];
  if (config.mode === "multiple" && !Array.isArray(value)) throw new ValidationError(`${field.label} requires multiple selections.`);
  if ((!selected.length || selected.every((entry) => entry == null || entry === "")) && config.minSelections > 0) throw new ValidationError(`${field.label} requires a selection.`);
  if (config.maxSelections != null && selected.length > config.maxSelections) throw new ValidationError(`${field.label} has too many selections.`);
  if (new Set(selected).size !== selected.length) throw new ValidationError(`${field.label} contains a duplicate choice.`);
  const ids = new Set(config.options.map((option) => option.id)); if (selected.some((id) => !ids.has(id))) throw new ValidationError(`${field.label} contains an invalid choice.`);
}

export function snapshotResultValue(field, value, units = []) {
  const snapshot = { fieldId: field.id, fieldVersion: field.definitionVersion, fieldLabel: field.label, type: field.type, required: Boolean(field.required), resultTagId: field.resultTagId || null, config: clone(field.config), value: clone(value) };
  if (field.type === "measurement") { const unit = unitMap(units).get(value?.unitId || field.config.defaultUnitId); snapshot.unitId = unit?.id || null; snapshot.unitSymbol = unit?.symbol || null; }
  if (field.type === "score") snapshot.maximum = normalizeResultConfig(field).maximum;
  if (field.type === "choice") { const options = normalizeResultConfig(field).options; const ids = Array.isArray(value) ? value : [value]; snapshot.choiceSnapshots = ids.map((id) => options.find((option) => option.id === id)).filter(Boolean).map((option) => ({ id: option.id, label: option.label, position: option.position, analysisScore: option.analysisScore })); }
  return snapshot;
}

export function analyzeResultValues({ field, values = [], units = [], operation = null, targetUnitId = null } = {}) {
  const config = normalizeResultConfig(field); const rows = values.filter((value) => value !== undefined && value !== null);
  if (!rows.length) return { count: 0, value: null, values: [] };
  if (field.type === "text") { const normalized = rows.map((value) => String(value)); const counts = Object.fromEntries([...new Set(normalized.map((value) => value.trim().toLocaleLowerCase()))].map((key) => [key, normalized.filter((value) => value.trim().toLocaleLowerCase() === key).length])); return { count: rows.length, value: normalized.at(-1), unique: Object.keys(counts).length, frequencies: counts, values: normalized }; }
  if (field.type === "choice") {
    const all = config.mode === "multiple" ? rows.flat() : rows; const frequencies = {};
    for (const value of all) frequencies[value] = (frequencies[value] || 0) + 1;
    const optionFor = (id) => config.options.find((option) => option.id === id);
    const ranks = all.map((id) => optionFor(id)?.position).filter(Number.isFinite).sort((a, b) => a - b);
    const scores = all.map((id) => optionFor(id)?.analysisScore).filter((score) => score != null);
    const ordinalAverage = config.orderMatters && ranks.length ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length : null;
    const medianRank = config.orderMatters && ranks.length ? ranks.length % 2 ? ranks[(ranks.length - 1) / 2] : (ranks[ranks.length / 2 - 1] + ranks[ranks.length / 2]) / 2 : null;
    const latest = rows.at(-1); const canRank = config.orderMatters && config.betterDirection !== "none"; const selected = operation === "latest" || !operation ? latest : operation === "highest" ? (canRank ? rows.slice().sort((a, b) => choiceAnalyticalValue(field, b) - choiceAnalyticalValue(field, a))[0] : latest) : operation === "lowest" ? (canRank ? rows.slice().sort((a, b) => choiceAnalyticalValue(field, a) - choiceAnalyticalValue(field, b))[0] : latest) : latest;
    return { count: rows.length, value: selected, frequencies, percentage: all.length ? Object.fromEntries(Object.entries(frequencies).map(([key, count]) => [key, count / all.length * 100])) : {}, ordinalAverage, medianRank, numericAverage: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null };
  }
  const numeric = field.type === "measurement" ? rows.map((entry) => {
    const unitId = entry?.unitId || config.defaultUnitId; return targetUnitId && unitId ? convertValue(entry.value, unitId, targetUnitId, units) : Number(entry.value);
  }) : rows.map(Number);
  if (field.type === "measurement" && operation === "total") return { count: rows.length, value: numeric.reduce((sum, value) => sum + value, 0) };
  const valuesSorted = [...numeric].sort((a, b) => a - b); const latest = numeric.at(-1); const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const value = operation === "latest" ? latest : ["min", "lowest"].includes(operation) ? valuesSorted[0] : ["max", "highest"].includes(operation) ? valuesSorted.at(-1) : operation === "total" ? numeric.reduce((sum, entry) => sum + entry, 0) : average;
  return { count: numeric.length, value, latest, min: valuesSorted[0], max: valuesSorted.at(-1), average, total: numeric.reduce((sum, entry) => sum + entry, 0), change: latest - numeric[0] };
}

export function normalizeForTextAnalysis(value) { return String(value ?? "").trim().toLocaleLowerCase(); }

export function choiceRank(field, optionId) {
  const option = normalizeResultConfig(field).options.find((candidate) => candidate.id === optionId);
  return option ? option.position : null;
}

export function choiceAnalyticalValue(field, optionId) {
  const config = normalizeResultConfig(field); const option = config.options.find((candidate) => candidate.id === optionId);
  if (!option || !config.orderMatters || config.betterDirection === "none") return null;
  return config.betterDirection === "lower" ? -option.position : option.position;
}

export function compareChoice(field, leftOptionId, rightOptionId) {
  const config = normalizeResultConfig(field); if (!config.orderMatters || config.betterDirection === "none") return null;
  const left = choiceRank(field, leftOptionId); const right = choiceRank(field, rightOptionId); if (left == null || right == null) return null;
  const direction = config.betterDirection === "lower" ? -1 : 1;
  return (left - right) * direction;
}
