import { createBackup } from "../infrastructure/backup.js";
import { clone } from "../shared/validation.js";

function packageId(packageType, exportedAt) { return `samt_${packageType}_${new Date(exportedAt).toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`; }
function rows(state, key) { return Array.isArray(state?.[key]) ? state[key] : []; }
function byId(state, key, id) { return rows(state, key).find((row) => row.id === id) || null; }

function reusableEnvelope(state, packageType, rootObjectIds, data, options = {}) {
  const exportedAt = options.exportedAt || new Date();
  return {
    format: "life-command",
    schemaVersion: 2,
    packageId: options.packageId || packageId(packageType, exportedAt),
    packageType,
    exportedAt: new Date(exportedAt).toISOString(),
    rootObjectIds: [...rootObjectIds],
    data: clone(data)
  };
}

function referencedTaxonomyAndUnits(state, actions, blocks) {
  const tagIds = new Set(); const unitIds = new Set();
  for (const action of actions) {
    for (const tagId of action.tagIds || []) tagIds.add(tagId);
    for (const field of action.resultFields || []) {
      if (field.resultTagId) tagIds.add(field.resultTagId);
      for (const id of [field.config?.defaultUnitId, ...(field.config?.allowedUnitIds || [])].filter(Boolean)) unitIds.add(id);
    }
  }
  for (const block of blocks) if (block.config?.unitId) unitIds.add(block.config.unitId);
  for (const block of blocks) for (const relationship of block.relationships || []) if (relationship.kind === "action") {
    const action = byId(state, "actions", relationship.refId);
    for (const tagId of action?.tagIds || []) tagIds.add(tagId);
    for (const field of action?.resultFields || []) for (const id of [field.config?.defaultUnitId, ...(field.config?.allowedUnitIds || [])].filter(Boolean)) unitIds.add(id);
  }
  const tags = rows(state, "tags").filter((tag) => tagIds.has(tag.id));
  const categories = rows(state, "categories").filter((category) => tags.some((tag) => tag.categoryId === category.id));
  const unitMap = new Map(rows(state, "units").map((unit) => [unit.id, unit]));
  const pendingUnitIds = [...unitIds];
  while (pendingUnitIds.length) {
    const baseUnitId = unitMap.get(pendingUnitIds.pop())?.baseUnitId;
    if (baseUnitId && !unitIds.has(baseUnitId)) { unitIds.add(baseUnitId); pendingUnitIds.push(baseUnitId); }
  }
  const units = rows(state, "units").filter((unit) => unitIds.has(unit.id));
  return { categories, tags, units };
}

export function exportActionPackage(state, rootActionId, options = {}) {
  const action = byId(state, "actions", rootActionId);
  if (!action) throw new Error(`Action not found: ${rootActionId}`);
  const dependencies = referencedTaxonomyAndUnits(state, [action], []);
  return reusableEnvelope(state, "action-package", [rootActionId], { ...dependencies, actions: [action] }, options);
}

export function exportBlockPackage(state, rootBlockId, options = {}) {
  const root = byId(state, "blocks", rootBlockId);
  if (!root) throw new Error(`Block not found: ${rootBlockId}`);
  const blockMap = new Map(rows(state, "blocks").map((block) => [block.id, block])); const actionMap = new Map(rows(state, "actions").map((action) => [action.id, action])); const blocks = []; const actions = [];
  function visit(block) {
    if (!block || blocks.some((candidate) => candidate.id === block.id)) return;
    blocks.push(block);
    for (const relationship of block.relationships || []) {
      if (relationship.kind === "block") visit(blockMap.get(relationship.refId));
      if (relationship.kind === "action" && actionMap.has(relationship.refId) && !actions.some((candidate) => candidate.id === relationship.refId)) actions.push(actionMap.get(relationship.refId));
    }
    for (const referencedBlockId of [block.config?.sourceBlockId, ...(block.config?.descendantBlockIds || []), ...(block.config?.requiredChildTargetIds || [])].filter(Boolean)) visit(blockMap.get(referencedBlockId));
    for (const actionId of block.config?.sourceActionIds || []) if (actionMap.has(actionId) && !actions.some((candidate) => candidate.id === actionId)) actions.push(actionMap.get(actionId));
  }
  visit(root);
  const dependencies = referencedTaxonomyAndUnits(state, actions, blocks);
  return reusableEnvelope(state, "block-package", [rootBlockId], { ...dependencies, actions, blocks }, options);
}

export function exportPackage(state, options = {}) {
  const packageType = options.packageType || options.type || "backup";
  if (packageType === "action-package") return exportActionPackage(state, options.rootObjectIds?.[0] || options.rootId, options);
  if (packageType === "block-package") return exportBlockPackage(state, options.rootObjectIds?.[0] || options.rootId, options);
  return createBackup(clone(state), { ...options, packageVersion: "3.0.0", packageType: "backup" });
}
export function serializePackage(state, options = {}) { return JSON.stringify(exportPackage(state, options), null, 2); }

export function packageCounts(packageValue) {
  const data = packageValue?.data || packageValue?.state || packageValue || {};
  const keys = ["categories", "tags", "units", "actions", "blocks", "activations", "runs", "occurrences", "actionLogs", "history", "periods", "targetEvaluations", "cycleSmallCycles", "cycleBigCycles", "scopeChangeEvents", "lifecycleEvents", "reviews", "tasks", "quickTasks", "bin", "tombstones", "importHistory"];
  return Object.fromEntries(keys.filter((key) => Array.isArray(data[key])).map((key) => [key, data[key].length]));
}
