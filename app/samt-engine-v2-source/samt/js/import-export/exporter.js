import { deepClone } from "../shared/validation.js";
import { getDescendantBlockIds, getDescendantActionIds } from "../domain/relationships.js";
import { PACKAGE_SCHEMA_VERSION } from "./migrations.js";

const REUSABLE_KEYS = ["categories", "tags", "units", "actions", "blocks", "activationPresets", "styles"];

function envelope({ id, type, now, roots, data }) {
  return { format: "life-command", schemaVersion: PACKAGE_SCHEMA_VERSION, packageId: id, packageType: type, exportedAt: now, rootObjectIds: roots, data };
}

function reusableData() { return Object.fromEntries(REUSABLE_KEYS.map((key) => [key, []])); }

export function exportFullBackup(state, { id, now }) {
  const data = deepClone(state);
  delete data.schemaVersion;
  delete data.appVersion;
  return envelope({ id, type: "backup", now, roots: [], data });
}

export function exportActionPackage(state, actionIds, { id, now }) {
  const roots = [...new Set(actionIds)];
  const data = reusableData();
  data.actions = state.actions.filter((item) => roots.includes(item.id)).map(deepClone);
  const tagIds = new Set(data.actions.flatMap((item) => item.tagIds || []));
  data.tags = state.tags.filter((item) => tagIds.has(item.id)).map(deepClone);
  const categoryIds = new Set(data.tags.map((item) => item.categoryId));
  data.categories = state.categories.filter((item) => categoryIds.has(item.id)).map(deepClone);
  const unitIds = new Set(data.actions.flatMap((item) => [item.result?.unitId, ...(item.result?.allowedUnitIds || [])]).filter(Boolean));
  data.units = state.units.filter((item) => unitIds.has(item.id)).map(deepClone);
  return envelope({ id, type: "action-package", now, roots, data });
}

export function exportBlockPackage(state, rootBlockIds, { id, now, includeActivationPresets = false }) {
  const roots = [...new Set(rootBlockIds)];
  const data = reusableData();
  const blockIds = new Set(roots);
  for (const rootId of roots) for (const nestedId of getDescendantBlockIds(state, rootId)) blockIds.add(nestedId);
  data.blocks = state.blocks.filter((item) => blockIds.has(item.id)).map(deepClone);
  const actionIds = new Set();
  for (const rootId of roots) for (const actionId of getDescendantActionIds(state, rootId)) actionIds.add(actionId);
  data.actions = state.actions.filter((item) => actionIds.has(item.id)).map(deepClone);
  const tagIds = new Set(data.actions.flatMap((item) => item.tagIds || []));
  data.tags = state.tags.filter((item) => tagIds.has(item.id)).map(deepClone);
  const categoryIds = new Set(data.tags.map((item) => item.categoryId));
  data.categories = state.categories.filter((item) => categoryIds.has(item.id)).map(deepClone);
  const unitIds = new Set(data.actions.flatMap((item) => [item.result?.unitId, ...(item.result?.allowedUnitIds || [])]).filter(Boolean));
  data.units = state.units.filter((item) => unitIds.has(item.id)).map(deepClone);
  if (includeActivationPresets) data.activationPresets = state.activationPresets.filter((item) => blockIds.has(item.blockId)).map(deepClone);
  return envelope({ id, type: "block-package", now, roots, data });
}

export function exportStylePackage(state, styleIds, { id, now }) {
  const data = reusableData();
  data.styles = state.styles.filter((item) => styleIds.includes(item.id)).map(deepClone);
  return envelope({ id, type: "style-package", now, roots: [...styleIds], data });
}
