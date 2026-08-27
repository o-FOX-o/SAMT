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
    for (const block of candidate.blocks) validateBlock(block); validateBlockGraph(candidate); for (const log of candidate.actionLogs) { validateActionLog(log); if (!actionIds.has(log.actionId)) throw new ImportError(`Action Log ${log.id} references a missing Action.`); }
    const ids = new Set(); for (const collection of [candidate.categories, candidate.tags, candidate.units, candidate.actions, candidate.blocks, candidate.activations || [], candidate.runs || [], candidate.occurrences || [], candidate.periods || [], candidate.actionLogs, candidate.history]) for (const item of collection) { if (!item?.id || !isStableId(item.id) || ids.has(item.id)) throw new ImportError(`Duplicate or missing stable ID: ${item?.id || "unknown"}`); ids.add(item.id); }
    const relationshipIds = new Set(); for (const block of candidate.blocks) for (const relationship of block.relationships || []) { if (!isStableId(relationship.id) || relationshipIds.has(relationship.id)) throw new ImportError(`Duplicate or missing relationship ID: ${relationship.id || "unknown"}`); relationshipIds.add(relationship.id); }
    const relationshipSet = new Set([...relationshipIds]); const occurrenceIds = new Set((candidate.occurrences || []).map((occurrence) => occurrence.id)); for (const occurrence of candidate.occurrences || []) { if (!relationshipSet.has(occurrence.relationshipId)) throw new ImportError(`Occurrence ${occurrence.id} references a missing Relationship.`); for (const logId of occurrence.logIds || []) if (!candidate.actionLogs.some((log) => log.id === logId)) throw new ImportError(`Occurrence ${occurrence.id} references a missing Action Log.`); }
    for (const run of candidate.runs || []) if (!candidate.blocks.some((block) => block.id === run.blockId)) throw new ImportError(`Run ${run.id} references a missing Block.`);
    for (const activation of candidate.activations || []) if (!candidate.blocks.some((block) => block.id === activation.blockId)) throw new ImportError(`Activation ${activation.id} references a missing Block.`);
    for (const evaluation of candidate.targetEvaluations || []) if (evaluation.periodId && !(candidate.periods || []).some((period) => period.id === evaluation.periodId)) throw new ImportError(`Target evaluation references a missing Period.`);
    return { ok: true, state: candidate };
  } catch (error) { return { ok: false, error: error instanceof ImportError ? error : new ImportError(error.message || "Package validation failed.", { cause: error }) }; }
}
