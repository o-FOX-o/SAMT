import { ImportError } from "../shared/errors.js";
import { validateTaxonomy } from "../domain/taxonomy.js";
import { validateAction } from "../domain/actions.js";
import { validateBlockGraph } from "../domain/relationships.js";
import { validateBlock } from "../domain/blocks.js";
import { validateActionLog } from "../domain/logs.js";
import { validateResultFields } from "../domain/results.js";
import { validateUnits } from "../domain/units.js";
import { isPlainObject } from "../shared/validation.js";
import { isStableId } from "../shared/ids.js";

export function validatePackage(packageValue) {
  const candidate = packageValue?.state || packageValue;
  try {
    if (!isPlainObject(candidate) || !String(candidate.schemaVersion || "").startsWith("3.")) throw new ImportError("This is not a SAMT schema-v3 package.");
    for (const key of ["categories", "tags", "units", "actions", "blocks", "actionLogs", "history"]) if (!Array.isArray(candidate[key])) throw new ImportError(`Package is missing ${key}.`);
    validateTaxonomy(candidate); validateUnits(candidate.units); const tagIds = new Set(candidate.tags.map((tag) => tag.id)); const actionIds = new Set(candidate.actions.map((action) => action.id));
    for (const action of candidate.actions) { validateAction(action, { units: candidate.units, tags: candidate.tags, categories: candidate.categories }); if ((action.tagIds || []).some((id) => !tagIds.has(id))) throw new ImportError(`Action ${action.id} references a missing Tag.`); validateResultFields(action.resultFields || [], candidate.units); }
    for (const block of candidate.blocks) validateBlock(block); validateBlockGraph(candidate); for (const log of candidate.actionLogs) { validateActionLog(log); const hasSnapshot = log.actionSnapshot?.id === log.actionId; const hasTombstone = (candidate.tombstones || []).some((tombstone) => tombstone.objectType === "action" && tombstone.objectId === log.actionId && (tombstone.snapshot?.id === log.actionId || !tombstone.snapshot)); if (!actionIds.has(log.actionId) && !hasSnapshot && !hasTombstone) throw new ImportError(`Action Log ${log.id} references a missing Action without a historical snapshot.`); }
    const ids = new Set(); for (const collection of [candidate.categories, candidate.tags, candidate.units, candidate.actions, candidate.blocks, candidate.activations || [], candidate.runs || [], candidate.occurrences || [], candidate.periods || [], candidate.targetEvaluations || [], candidate.cycleSmallCycles || [], candidate.cycleBigCycles || [], candidate.actionLogs, candidate.history, candidate.bin || [], candidate.tombstones || [], candidate.importHistory || []]) for (const item of collection) { if (!item?.id || !isStableId(item.id) || ids.has(item.id)) throw new ImportError(`Duplicate or missing stable ID: ${item?.id || "unknown"}`); ids.add(item.id); }
    const relationshipIds = new Set(); for (const block of candidate.blocks) for (const relationship of block.relationships || []) { if (!isStableId(relationship.id) || relationshipIds.has(relationship.id)) throw new ImportError(`Duplicate or missing relationship ID: ${relationship.id || "unknown"}`); relationshipIds.add(relationship.id); }
    const relationshipSet = new Set([...relationshipIds]); const occurrenceIds = new Set((candidate.occurrences || []).map((occurrence) => occurrence.id)); for (const occurrence of candidate.occurrences || []) { if (!relationshipSet.has(occurrence.relationshipId) && occurrence.snapshot?.relationshipSnapshot?.id !== occurrence.relationshipId) throw new ImportError(`Occurrence ${occurrence.id} references a missing Relationship without a historical snapshot.`); for (const logId of occurrence.logIds || []) if (!candidate.actionLogs.some((log) => log.id === logId)) throw new ImportError(`Occurrence ${occurrence.id} references a missing Action Log.`); }
    for (const run of candidate.runs || []) if (!candidate.blocks.some((block) => block.id === run.blockId) && run.snapshot?.block?.id !== run.blockId && run.blockSnapshot?.id !== run.blockId) throw new ImportError(`Run ${run.id} references a missing Block without a historical snapshot.`);
    for (const activation of candidate.activations || []) if (!candidate.blocks.some((block) => block.id === activation.blockId) && activation.blockSnapshot?.id !== activation.blockId) throw new ImportError(`Activation ${activation.id} references a missing Block without a historical snapshot.`);
    for (const evaluation of candidate.targetEvaluations || []) if (evaluation.periodId && !(candidate.periods || []).some((period) => period.id === evaluation.periodId) && evaluation.periodSnapshot?.id !== evaluation.periodId) throw new ImportError(`Target evaluation references a missing Period without a historical snapshot.`);
    return { ok: true, state: candidate };
  } catch (error) { return { ok: false, error: error instanceof ImportError ? error : new ImportError(error.message || "Package validation failed.", { cause: error }) }; }
}
