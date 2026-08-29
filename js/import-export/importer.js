import { ImportError } from "../shared/errors.js";
import { clone, isPlainObject, normalizedKey } from "../shared/validation.js";
import { createEmptyState, normalizeState } from "../application/normalization.js";
import { validatePackage } from "./validator.js";
import { packageCounts } from "./exporter.js";

const LEGACY_PACKAGE_TYPES = new Set(["action-package", "block-package", "style-package", "backup"]);
const MERGE_KEYS = ["categories", "tags", "units", "actions", "blocks", "activations", "runs", "occurrences", "periods", "actionLogs", "targetEvaluations", "cycleSmallCycles", "cycleBigCycles", "scopeChangeEvents", "lifecycleEvents", "history", "tasks", "quickTasks", "reviews"];

function isLegacyEnvelope(value) {
  return Boolean(value && value.format === "life-command" && (Number(value.schemaVersion) === 1 || Number(value.schemaVersion) === 2));
}

function validateLegacyEnvelope(value) {
  if (!isPlainObject(value) || value.format !== "life-command") throw new ImportError("Not a SAMT package.");
  if (![1, 2].includes(Number(value.schemaVersion))) throw new ImportError("Unsupported SAMT package schema.");
  if (!LEGACY_PACKAGE_TYPES.has(value.packageType)) throw new ImportError("Package type is invalid.");
  if (typeof value.packageId !== "string" || !value.packageId || !Number.isFinite(Date.parse(value.exportedAt))) throw new ImportError("Package envelope is invalid.");
  if (!Array.isArray(value.rootObjectIds) || value.rootObjectIds.some((id) => typeof id !== "string" || !id)) throw new ImportError("Package roots are invalid.");
  if (!isPlainObject(value.data)) throw new ImportError("Package data is invalid.");
  const ids = new Set();
  for (const [collection, rows] of Object.entries(value.data)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id) throw new ImportError(`Package ${collection} contains a record without a stable ID.`);
      if (ids.has(row.id)) throw new ImportError(`Package contains a duplicate stable ID: ${row.id}`);
      ids.add(row.id);
      if (collection === "blocks") for (const relationship of row.children || row.relationships || []) {
        if (!relationship?.id || ids.has(relationship.id)) throw new ImportError("Package contains a duplicate or missing relationship ID.");
        ids.add(relationship.id);
      }
    }
  }
  if (value.packageType === "backup" && value.rootObjectIds.length) throw new ImportError("A Full Backup cannot declare reusable roots.");
  if (value.packageType !== "backup") {
    const rootRows = value.packageType === "action-package" ? value.data.actions : value.packageType === "block-package" ? value.data.blocks : value.data.styles;
    const roots = new Set((rootRows || []).map((row) => row.id));
    if (value.rootObjectIds.some((id) => !roots.has(id))) throw new ImportError("A package root is missing from its data.");
  }
  return true;
}

function migrateLegacyEnvelope(value, now) {
  validateLegacyEnvelope(value);
  const data = clone(value.data) || {};
  // V2 packages use Block.children and a single Action.result field. The
  // normalizer accepts those legacy names and creates V3 relationships and
  // Result Fields while retaining the original package below as metadata.
  const source = { ...data, schemaVersion: "2.0.0" };
  source.blocks = (source.blocks || []).map((block) => ({
    ...block,
    relationships: block.relationships || block.children || [],
    definitionStatus: block.definitionStatus || block.status
  }));
  source.actions = (source.actions || []).map((action) => ({
    ...action,
    direction: action.direction || (action.polarity === "negative" ? "avoid" : "do")
  }));
  const migrated = normalizeState(source, { now });
  // Reusable V3 packages carry their exact taxonomy records. The legacy
  // state migrator historically generated one tag per Category, which would
  // lose custom Tag IDs from an exported Action/Block package.
  if (Array.isArray(data.tags)) migrated.tags = clone(data.tags);
  migrated.legacy = {
    ...(migrated.legacy || {}),
    sourcePackage: {
      format: value.format,
      schemaVersion: Number(value.schemaVersion),
      packageId: value.packageId,
      packageType: value.packageType,
      exportedAt: value.exportedAt,
      rootObjectIds: clone(value.rootObjectIds),
      data
    }
  };
  return migrated;
}

function indexById(rows = []) { return new Map(rows.map((row) => [row.id, row])); }

function buildIdMap(existingRows = [], incomingRows = [], key = (row) => normalizedKey(row.name)) {
  const byId = indexById(existingRows); const byName = new Map();
  for (const row of existingRows) { const name = key(row); if (name && !byName.has(name)) byName.set(name, row.id); }
  const map = new Map();
  for (const row of incomingRows) map.set(row.id, byId.has(row.id) ? row.id : byName.get(key(row)) || row.id);
  return map;
}

function rewriteLegacyRecords(incoming, maps) {
  const rewriteId = (map, id) => id && map.get(id) || id;
  incoming.categories = (incoming.categories || []).map((category) => ({ ...category, id: rewriteId(maps.categories, category.id) }));
  incoming.units = (incoming.units || []).map((unit) => ({ ...unit, id: rewriteId(maps.units, unit.id), baseUnitId: rewriteId(maps.units, unit.baseUnitId) }));
  incoming.tags = (incoming.tags || []).map((tag) => ({ ...tag, id: rewriteId(maps.tags, tag.id), categoryId: rewriteId(maps.categories, tag.categoryId) }));
  incoming.actions = (incoming.actions || []).map((action) => ({
    ...action,
    id: rewriteId(maps.actions, action.id),
    tagIds: (action.tagIds || []).map((id) => rewriteId(maps.tags, id)),
    resultFields: (action.resultFields || []).map((field) => ({
      ...field,
      resultTagId: rewriteId(maps.tags, field.resultTagId),
      config: { ...(field.config || {}), defaultUnitId: rewriteId(maps.units, field.config?.defaultUnitId), allowedUnitIds: (field.config?.allowedUnitIds || []).map((id) => rewriteId(maps.units, id)) }
    }))
  }));
  incoming.blocks = (incoming.blocks || []).map((block) => ({
    ...block,
    id: rewriteId(maps.blocks, block.id),
    relationships: (block.relationships || []).map((relationship) => ({
      ...relationship,
      parentBlockId: rewriteId(maps.blocks, relationship.parentBlockId || block.id),
      refId: relationship.kind === "block" ? rewriteId(maps.blocks, relationship.refId) : rewriteId(maps.actions, relationship.refId),
      config: { ...(relationship.config || {}), schedule: relationship.schedule || relationship.config?.schedule || null }
    })),
    config: {
      ...(block.config || {}),
      sourceActionIds: (block.config?.sourceActionIds || []).map((id) => rewriteId(maps.actions, id)),
      sourceBlockId: rewriteId(maps.blocks, block.config?.sourceBlockId),
      descendantBlockIds: (block.config?.descendantBlockIds || []).map((id) => rewriteId(maps.blocks, id)),
      requiredChildTargetIds: (block.config?.requiredChildTargetIds || []).map((id) => rewriteId(maps.blocks, id))
    }
  }));
  incoming.actionLogs = (incoming.actionLogs || []).map((log) => ({
    ...log,
    actionId: rewriteId(maps.actions, log.actionId),
    contextRefs: (log.contextRefs || []).map((reference) => ({ ...reference, blockId: rewriteId(maps.blocks, reference.blockId), runId: rewriteId(maps.runs, reference.runId), occurrenceId: rewriteId(maps.occurrences, reference.occurrenceId) }))
  }));
  incoming.runs = (incoming.runs || []).map((run) => ({ ...run, blockId: rewriteId(maps.blocks, run.blockId), activationId: rewriteId(maps.activations, run.activationId) }));
  incoming.activations = (incoming.activations || []).map((activation) => ({ ...activation, blockId: rewriteId(maps.blocks, activation.blockId) }));
  incoming.occurrences = (incoming.occurrences || []).map((occurrence) => ({ ...occurrence, relationshipId: rewriteId(maps.relationships, occurrence.relationshipId), logIds: (occurrence.logIds || []).map((id) => rewriteId(maps.actionLogs, id)) }));
  incoming.periods = (incoming.periods || []).map((period) => ({ ...period, ownerId: rewriteId(maps.blocks, period.ownerId || period.blockId) }));
  incoming.targetEvaluations = (incoming.targetEvaluations || []).map((evaluation) => ({ ...evaluation, ownerId: rewriteId(maps.blocks, evaluation.ownerId), periodId: rewriteId(maps.periods, evaluation.periodId) }));
  incoming.cycleSmallCycles = (incoming.cycleSmallCycles || []).map((cycle) => ({ ...cycle, cycleId: rewriteId(maps.blocks, cycle.cycleId), bigCycleId: rewriteId(maps.cycleBigCycles, cycle.bigCycleId) }));
  incoming.cycleBigCycles = (incoming.cycleBigCycles || []).map((cycle) => ({ ...cycle, cycleId: rewriteId(maps.blocks, cycle.cycleId), smallCycles: (cycle.smallCycles || []).map((small) => ({ ...small, id: rewriteId(maps.cycleSmallCycles, small.id) })) }));
  incoming.scopeChangeEvents = (incoming.scopeChangeEvents || []).map((event) => ({ ...event, blockId: rewriteId(maps.blocks, event.blockId), runIds: (event.runIds || []).map((id) => rewriteId(maps.runs, id)) }));
  incoming.history = (incoming.history || []).map((event) => ({ ...event, objectId: rewriteId(maps.actions, rewriteId(maps.blocks, event.objectId)), actionId: rewriteId(maps.actions, event.actionId), blockId: rewriteId(maps.blocks, event.blockId), ownerId: rewriteId(maps.blocks, event.ownerId) }));
  return incoming;
}

function mergeLegacyPackage(existingState, incomingState, envelope, now) {
  const result = normalizeState(existingState || createEmptyState(now), { now });
  const incoming = clone(incomingState);
  const maps = {
    categories: buildIdMap(result.categories, incoming.categories),
    units: buildIdMap(result.units, incoming.units, (row) => `${normalizedKey(row.name)}:${normalizedKey(row.symbol)}`),
    actions: buildIdMap(result.actions, incoming.actions),
    blocks: buildIdMap(result.blocks, incoming.blocks)
  };
  maps.tags = buildIdMap(result.tags, incoming.tags, (row) => `${rewriteCategoryKey(row, maps.categories)}:${normalizedKey(row.name)}`);
  maps.relationships = new Map(); maps.actionLogs = new Map(); maps.runs = new Map(); maps.occurrences = new Map(); maps.activations = new Map(); maps.periods = new Map(); maps.cycleSmallCycles = new Map(); maps.cycleBigCycles = new Map();
  for (const block of incoming.blocks || []) for (const relationship of block.relationships || []) maps.relationships.set(relationship.id, relationship.id);
  for (const key of ["actionLogs", "runs", "occurrences", "activations", "periods", "cycleSmallCycles", "cycleBigCycles"]) for (const row of incoming[key] || []) maps[key].set(row.id, row.id);
  rewriteLegacyRecords(incoming, maps);
  const allowed = envelope.packageType === "action-package" ? new Set(["categories", "tags", "units", "actions"]) : envelope.packageType === "block-package" ? new Set(["categories", "tags", "units", "actions", "blocks", "activations", "runs", "occurrences", "periods", "actionLogs", "targetEvaluations", "cycleSmallCycles", "cycleBigCycles", "scopeChangeEvents", "lifecycleEvents", "history"]) : new Set(MERGE_KEYS);
  for (const key of MERGE_KEYS) {
    if (!allowed.has(key) || !Array.isArray(incoming[key])) continue;
    const rows = result[key] || []; const byId = indexById(rows);
    for (const row of incoming[key]) {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index < 0) rows.push(clone(row)); else if (envelope.packageType !== "style-package") rows[index] = { ...rows[index], ...clone(row), id: row.id };
      byId.set(row.id, row);
    }
    result[key] = rows;
  }
  result.legacy = { ...(result.legacy || {}), importedPackage: clone(envelope) };
  result.updatedAt = new Date(now).toISOString();
  return result;
}

function rewriteCategoryKey(row, categories) { return categories.get(row.categoryId) || row.categoryId || ""; }

export function importPackage(packageValue, { existingState = null, now = new Date(), conflict = "replace" } = {}) {
  if (isLegacyEnvelope(packageValue)) {
    const migrated = migrateLegacyEnvelope(packageValue, now);
    const candidate = packageValue.packageType === "backup" ? migrated : mergeLegacyPackage(existingState, migrated, packageValue, now);
    const checked = validatePackage(candidate); if (!checked.ok) throw checked.error;
    return { state: clone(candidate), restorePoint: clone(existingState) };
  }
  const raw = packageValue?.state || packageValue;
  const isLegacyState = String(raw?.schemaVersion || "").startsWith("2.") || String(raw?.schemaVersion || "").startsWith("1.");
  if (!isLegacyState) { const rawChecked = validatePackage(raw); if (!rawChecked.ok) throw rawChecked.error; }
  const candidate = normalizeState(raw, { now }); const checked = validatePackage(candidate); if (!checked.ok) throw checked.error;
  if (conflict === "preserve_existing" && existingState) return { state: mergePreservingExisting(existingState, candidate), restorePoint: clone(existingState) };
  return { state: clone(candidate), restorePoint: clone(existingState) };
}

export function previewImport(packageValue, { existingState = null, now = new Date(), conflict = "replace" } = {}) {
  const result = importPackage(packageValue, { existingState, now, conflict });
  const data = packageValue?.data || packageValue?.state || packageValue || {};
  const packageType = packageValue?.packageType || (packageValue?.format === "life-command" ? "backup" : "backup");
  const packageId = packageValue?.packageId || packageValue?.meta?.packageId || `samt_${packageType}`;
  const existing = existingState || {};
  const definitionKeys = ["categories", "tags", "units", "actions", "blocks"];
  const existingIds = new Set(definitionKeys.flatMap((key) => (existing[key] || []).map((row) => row.id)));
  const incomingIds = definitionKeys.flatMap((key) => (data[key] || []).map((row) => row.id));
  const sameNameActions = new Set((data.actions || []).filter((action) => {
    const key = normalizedKey(action.name);
    return key && (existing.actions || []).some((current) => current.id !== action.id && normalizedKey(current.name) === key);
  }).map((action) => action.id));
  return {
    ...result,
    summary: {
      packageType,
      packageId,
      packageName: packageValue?.packageName || packageValue?.name || packageId,
      counts: packageCounts(packageValue),
      conflicts: {
        existingIds: new Set(incomingIds.filter((id) => existingIds.has(id))).size,
        sameNameActions: sameNameActions.size,
        invalidReferences: 0
      },
      restorePointCreated: Boolean(existingState)
    }
  };
}

function mergePreservingExisting(existing, incoming) {
  const result = clone(existing); for (const key of MERGE_KEYS) { const rows = result[key] || []; const ids = new Set(rows.map((row) => row.id)); result[key] = [...rows, ...(incoming[key] || []).filter((row) => !ids.has(row.id))]; } return result;
}
