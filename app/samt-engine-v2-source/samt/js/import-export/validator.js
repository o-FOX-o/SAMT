import { ImportError } from "../shared/errors.js";
import { assertUniqueIds, assertUniqueNormalizedNames } from "../shared/validation.js";
import { validateActionDefinition } from "../domain/actions.js";
import { validateBlockDefinition } from "../domain/blocks.js";
import { validateBlockGraph } from "../domain/relationships.js";
import { validateAvoidEvaluation } from "../domain/avoid.js";
import { normalizeTargetConfig, validateTargetConfig } from "../domain/targets.js";
import { PACKAGE_SCHEMA_VERSION, migratePackage } from "./migrations.js";

const ID_COLLECTIONS = ["categories", "tags", "units", "actions", "blocks", "activationPresets", "activations", "runs", "occurrences", "actionLogs", "history", "analysisTargets", "targetPeriods", "avoidPeriods", "periodEvaluations", "styles", "restorePoints", "importHistory", "bin"];

export function validateState(state) {
  if (!state || typeof state !== "object") throw new ImportError("SAMT state must be an object.");
  for (const key of ID_COLLECTIONS) if (!Array.isArray(state[key])) throw new ImportError(`SAMT state is missing ${key}.`);
  assertUniqueIds(Object.fromEntries(ID_COLLECTIONS.map((key) => [key, state[key]])));
  assertUniqueNormalizedNames(state.categories, "Category");
  assertUniqueNormalizedNames(state.tags, "Tag");
  assertUniqueNormalizedNames(state.actions, "Action");
  assertUniqueNormalizedNames(state.blocks, "Block");
  const categoryIds = new Set(state.categories.map((item) => item.id));
  const tagIds = new Set(state.tags.map((item) => item.id));
  const unitIds = new Set(state.units.map((item) => item.id));
  for (const tag of state.tags) if (!categoryIds.has(tag.categoryId)) throw new ImportError("A Tag references a missing Category.", { tagId: tag.id });
  for (const input of state.actions) {
    const action = validateActionDefinition(input);
    if (action.tagIds.some((id) => !tagIds.has(id))) throw new ImportError("An Action references a missing Tag.", { actionId: action.id });
    if (action.result.mode === "measurement" && action.result.unitId && !unitIds.has(action.result.unitId)) throw new ImportError("An Action references a missing Unit.", { actionId: action.id });
  }
  for (const input of state.blocks) {
    const block = validateBlockDefinition(input);
    if (block.type === "target") validateTargetConfig(normalizeTargetConfig(block));
    if (block.direction === "avoid") validateAvoidEvaluation(block.typeConfig.avoidEvaluation || {});
  }
  validateBlockGraph(state);
  return { ok: true };
}

export function validatePackage(input) {
  const pkg = migratePackage(input);
  if (!pkg || pkg.format !== "life-command") throw new ImportError("NOT A VALID LIFE COMMAND PACKAGE");
  if (Number(pkg.schemaVersion) > PACKAGE_SCHEMA_VERSION) throw new ImportError("THIS PACKAGE REQUIRES A NEWER LIFE COMMAND VERSION");
  if (Number(pkg.schemaVersion) !== PACKAGE_SCHEMA_VERSION) throw new ImportError("NOT A VALID LIFE COMMAND PACKAGE");
  if (!["action-package", "block-package", "style-package", "backup"].includes(pkg.packageType)) throw new ImportError("Package type is invalid.");
  if (typeof pkg.packageId !== "string" || !pkg.packageId || Number.isNaN(Date.parse(pkg.exportedAt)) || !Array.isArray(pkg.rootObjectIds) || !pkg.data || typeof pkg.data !== "object") throw new ImportError("Package envelope is invalid.");
  return { ok: true, package: pkg };
}
