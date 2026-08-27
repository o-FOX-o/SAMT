import { ImportError } from "../shared/errors.js";
import { assertUniqueIds, assertUniqueNormalizedNames } from "../shared/validation.js";
import { validateActionDefinition } from "../domain/actions.js";
import { validateBlockDefinition } from "../domain/blocks.js";
import { validateBlockGraph } from "../domain/relationships.js";
import { validateAvoidEvaluation } from "../domain/avoid.js";
import { normalizeTargetConfig, validateTargetConfig } from "../domain/targets.js";
import { normalizeSchedule } from "../domain/scheduling.js";
import { PACKAGE_SCHEMA_VERSION, migratePackage } from "./migrations.js";

const ID_COLLECTIONS = ["categories", "tags", "units", "actions", "blocks", "activationPresets", "activations", "runs", "occurrences", "actionLogs", "history", "analysisTargets", "targetPeriods", "avoidPeriods", "cyclePeriods", "periodEvaluations", "styles", "restorePoints", "importHistory", "bin"];
const CLOSED_OCCURRENCES = new Set(["completed", "skipped", "missed"]);
const CLOSED_RUNS = new Set(["completed", "cancelled", "abandoned", "failed"]);

function requireReference(condition, message, details) {
  if (!condition) throw new ImportError(message, details);
}

function validDate(value) {
  return value == null || value === "" || Number.isFinite(Date.parse(value));
}

export function validateState(state) {
  if (!state || typeof state !== "object") throw new ImportError("SAMT state must be an object.");
  for (const key of ID_COLLECTIONS) if (!Array.isArray(state[key])) throw new ImportError(`SAMT state is missing ${key}.`);
  const relationships = state.blocks.flatMap((block) => block.children || []);
  assertUniqueIds({ ...Object.fromEntries(ID_COLLECTIONS.map((key) => [key, state[key]])), relationships });
  assertUniqueNormalizedNames(state.categories, "Category");
  assertUniqueNormalizedNames(state.tags, "Tag");
  assertUniqueNormalizedNames(state.actions, "Action");
  assertUniqueNormalizedNames(state.blocks, "Block");
  const categoryIds = new Set(state.categories.map((item) => item.id));
  const tagIds = new Set(state.tags.map((item) => item.id));
  const unitIds = new Set(state.units.map((item) => item.id));
  const actionIds = new Set(state.actions.map((item) => item.id));
  const blockIds = new Set(state.blocks.map((item) => item.id));
  const relationshipIds = new Set(relationships.map((item) => item.id));
  const activationIds = new Set(state.activations.map((item) => item.id));
  const runIds = new Set(state.runs.map((item) => item.id));
  const occurrenceIds = new Set(state.occurrences.map((item) => item.id));
  const actionLogIds = new Set(state.actionLogs.map((item) => item.id));
  for (const tag of state.tags) if (!categoryIds.has(tag.categoryId)) throw new ImportError("A Tag references a missing Category.", { tagId: tag.id });
  for (const input of state.actions) {
    const action = validateActionDefinition(input);
    if (action.tagIds.some((id) => !tagIds.has(id))) throw new ImportError("An Action references a missing Tag.", { actionId: action.id });
    if (action.result.mode === "measurement" && action.result.unitId && !unitIds.has(action.result.unitId)) throw new ImportError("An Action references a missing Unit.", { actionId: action.id });
    if ((action.result.allowedUnitIds || []).some((id) => !unitIds.has(id))) throw new ImportError("An Action allows a missing Unit.", { actionId: action.id });
  }
  for (const input of state.blocks) {
    const block = validateBlockDefinition(input);
    if (block.type === "target") validateTargetConfig(normalizeTargetConfig(block));
    if (block.direction === "avoid") validateAvoidEvaluation(block.typeConfig.avoidEvaluation || {});
    const directBlockIds = new Set(block.children.filter((child) => child.kind === "block").map((child) => child.refId));
    const requiredTargetIds = block.typeConfig?.requiredChildBlockIds || [];
    if (requiredTargetIds.some((id) => !directBlockIds.has(id))) throw new ImportError("A Target requires a Block that is not its direct child.", { blockId: block.id });
    const avoidRequiredIds = block.typeConfig?.avoidEvaluation?.requiredChildBlockIds || [];
    if (avoidRequiredIds.some((id) => !directBlockIds.has(id))) throw new ImportError("An Avoid evaluation requires a Block that is not its direct child.", { blockId: block.id });
    for (const relationship of block.children) {
      if (relationship.schedule) normalizeSchedule(relationship.schedule);
      if (relationship.avoidEvaluation) validateAvoidEvaluation(relationship.avoidEvaluation);
    }
    for (const target of block.projectTargets || []) {
      if (target.actionId && target.blockId) throw new ImportError("A Project Target cannot reference both an Action and a Target Block.", { blockId: block.id, projectTargetId: target.id });
      if (target.actionId) requireReference(actionIds.has(target.actionId), "A Project Target references a missing Action.", { blockId: block.id, actionId: target.actionId });
      if (target.blockId) {
        const targetBlock = state.blocks.find((item) => item.id === target.blockId);
        requireReference(targetBlock?.type === "target", "A Project Target must reference an existing Target Block.", { blockId: block.id, targetBlockId: target.blockId });
      }
      if (!target.blockId) {
        const metric = target.metric || target.targetMetric || "quantity";
        if (!["time", "quantity", "completion_count"].includes(metric) || !(Number(target.targetValue ?? target.value ?? target.amount) > 0)) throw new ImportError("An inline Project Target needs a valid metric and positive target value.", { blockId: block.id, projectTargetId: target.id });
      }
      if (target.unitId) requireReference(unitIds.has(target.unitId), "A Project Target references a missing Unit.", { blockId: block.id, unitId: target.unitId });
    }
  }
  validateBlockGraph(state);
  for (const preset of state.activationPresets) requireReference(blockIds.has(preset.blockId), "An Activation Preset references a missing Block.", { presetId: preset.id, blockId: preset.blockId });
  for (const activation of state.activations) {
    if (!blockIds.has(activation.blockId) && !["paused", "completed", "archived", "cancelled"].includes(activation.status)) throw new ImportError("A live Activation references a missing Block.", { activationId: activation.id, blockId: activation.blockId });
    requireReference(validDate(activation.startAt) && validDate(activation.pausedAt) && validDate(activation.resumeAt), "An Activation contains an invalid timestamp.", { activationId: activation.id });
  }
  for (const run of state.runs) {
    if (!blockIds.has(run.blockId) && !CLOSED_RUNS.has(run.status)) throw new ImportError("A live Run references a missing Block.", { runId: run.id, blockId: run.blockId });
    if (run.activationId) requireReference(activationIds.has(run.activationId) || CLOSED_RUNS.has(run.status), "A live Run references a missing Activation.", { runId: run.id, activationId: run.activationId });
    requireReference((run.actionLogIds || []).every((id) => actionLogIds.has(id)), "A Run references a missing Action Log.", { runId: run.id });
    requireReference(validDate(run.startAt) && validDate(run.endAt), "A Run contains an invalid timestamp.", { runId: run.id });
  }
  for (const occurrence of state.occurrences) {
    if (!actionIds.has(occurrence.actionId) && !CLOSED_OCCURRENCES.has(occurrence.status)) throw new ImportError("An open Occurrence references a missing Action.", { occurrenceId: occurrence.id, actionId: occurrence.actionId });
    const parentBlockId = occurrence.parentBlockId || occurrence.blockId || occurrence.contextBlockId;
    if (parentBlockId && !blockIds.has(parentBlockId) && !CLOSED_OCCURRENCES.has(occurrence.status)) throw new ImportError("An open Occurrence references a missing Block.", { occurrenceId: occurrence.id, blockId: parentBlockId });
    if (occurrence.relationshipId && !relationshipIds.has(occurrence.relationshipId) && !CLOSED_OCCURRENCES.has(occurrence.status)) throw new ImportError("An open Occurrence references a missing relationship.", { occurrenceId: occurrence.id, relationshipId: occurrence.relationshipId });
    requireReference((occurrence.actionLogIds || []).every((id) => actionLogIds.has(id)), "An Occurrence references a missing Action Log.", { occurrenceId: occurrence.id });
    requireReference(validDate(occurrence.availableAt) && validDate(occurrence.dueAt) && validDate(occurrence.completedAt), "An Occurrence contains an invalid timestamp.", { occurrenceId: occurrence.id });
  }
  for (const log of state.actionLogs) {
    requireReference(actionIds.has(log.actionId) || Boolean(log.actionNameSnapshot), "An Action Log needs its Action or a historical name snapshot.", { actionLogId: log.id, actionId: log.actionId });
    requireReference(validDate(log.timestamp || log.eventAt || log.createdAt), "An Action Log contains an invalid timestamp.", { actionLogId: log.id });
    requireReference((log.linkedRunIds || []).every((id) => runIds.has(id)), "An Action Log references a missing Run.", { actionLogId: log.id });
    requireReference((log.linkedOccurrenceIds || []).every((id) => occurrenceIds.has(id)), "An Action Log references a missing Occurrence.", { actionLogId: log.id });
  }
  for (const [kind, records] of [["Target", state.targetPeriods], ["Avoid", state.avoidPeriods], ["Cycle", state.cyclePeriods]]) {
    for (const record of records) {
      const closed = Boolean(record.closedAt) || record.lifecycleStatus === "closed" || !["open", "in_progress"].includes(record.status);
      if (record.blockId && !blockIds.has(record.blockId) && !closed) throw new ImportError(`An open ${kind} period references a missing Block.`, { periodId: record.id, blockId: record.blockId });
      if (record.actionId && !actionIds.has(record.actionId) && !closed) throw new ImportError(`An open ${kind} period references a missing Action.`, { periodId: record.id, actionId: record.actionId });
      if (!closed) requireReference((record.actionLogIds || []).every((id) => actionLogIds.has(id)), `${kind} period references a missing Action Log.`, { periodId: record.id });
      requireReference(validDate(record.periodStart) && validDate(record.periodEnd) && validDate(record.closedAt), `${kind} period contains an invalid timestamp.`, { periodId: record.id });
    }
  }
  if (state.settings?.primaryProjectId) {
    const project = state.blocks.find((block) => block.id === state.settings.primaryProjectId);
    requireReference(project?.type === "project", "Primary Project must reference an existing Project Block.", { blockId: state.settings.primaryProjectId });
  }
  return { ok: true };
}

export function validatePackage(input) {
  const pkg = migratePackage(input);
  if (!pkg || pkg.format !== "life-command") throw new ImportError("NOT A VALID LIFE COMMAND PACKAGE");
  if (Number(pkg.schemaVersion) > PACKAGE_SCHEMA_VERSION) throw new ImportError("THIS PACKAGE REQUIRES A NEWER LIFE COMMAND VERSION");
  if (Number(pkg.schemaVersion) !== PACKAGE_SCHEMA_VERSION) throw new ImportError("NOT A VALID LIFE COMMAND PACKAGE");
  if (!["action-package", "block-package", "style-package", "backup"].includes(pkg.packageType)) throw new ImportError("Package type is invalid.");
  if (typeof pkg.packageId !== "string" || !pkg.packageId || Number.isNaN(Date.parse(pkg.exportedAt)) || !Array.isArray(pkg.rootObjectIds) || !pkg.data || typeof pkg.data !== "object") throw new ImportError("Package envelope is invalid.");
  if (new Set(pkg.rootObjectIds).size !== pkg.rootObjectIds.length || pkg.rootObjectIds.some((id) => typeof id !== "string" || !id)) throw new ImportError("Package roots are invalid.");
  const packageIds = new Map();
  for (const [collection, values] of Object.entries(pkg.data)) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!value || typeof value.id !== "string" || !value.id) throw new ImportError(`Package ${collection} contains a record without a stable ID.`);
      if (packageIds.has(value.id)) throw new ImportError("Package contains a duplicate stable ID.", { id: value.id, first: packageIds.get(value.id), second: collection });
      packageIds.set(value.id, collection);
      if (collection === "blocks") for (const relationship of value.children || []) {
        if (!relationship || typeof relationship.id !== "string" || !relationship.id) throw new ImportError("Package contains a relationship without a stable ID.");
        if (packageIds.has(relationship.id)) throw new ImportError("Package contains a duplicate stable ID.", { id: relationship.id, first: packageIds.get(relationship.id), second: "relationships" });
        packageIds.set(relationship.id, "relationships");
      }
    }
  }
  const rootCollection = pkg.packageType === "action-package" ? pkg.data.actions : pkg.packageType === "block-package" ? pkg.data.blocks : pkg.packageType === "style-package" ? pkg.data.styles : [];
  if (pkg.packageType === "backup" && pkg.rootObjectIds.length) throw new ImportError("A Full Backup cannot declare reusable roots.");
  if (pkg.packageType !== "backup") {
    const available = new Set((rootCollection || []).map((item) => item.id));
    if (pkg.rootObjectIds.some((id) => !available.has(id))) throw new ImportError("A package root is missing from its data.");
  }
  return { ok: true, package: pkg };
}
