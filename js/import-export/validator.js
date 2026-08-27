import { ImportError } from "../shared/errors.js";
import { validateTaxonomy } from "../domain/taxonomy.js";
import { validateAction } from "../domain/actions.js";
import { validateBlockGraph } from "../domain/relationships.js";
import { validateBlock } from "../domain/blocks.js";
import { validateActionLog } from "../domain/logs.js";
import { isPlainObject } from "../shared/validation.js";

export function validatePackage(packageValue) {
  const candidate = packageValue?.state || packageValue;
  try {
    if (!isPlainObject(candidate) || !String(candidate.schemaVersion || "").startsWith("3.")) throw new ImportError("This is not a SAMT schema-v3 package.");
    for (const key of ["categories", "tags", "units", "actions", "blocks", "actionLogs", "history"]) if (!Array.isArray(candidate[key])) throw new ImportError(`Package is missing ${key}.`);
    validateTaxonomy(candidate); for (const action of candidate.actions) validateAction(action, { units: candidate.units }); for (const block of candidate.blocks) validateBlock(block); validateBlockGraph(candidate); for (const log of candidate.actionLogs) validateActionLog(log);
    const ids = new Set(); for (const collection of [candidate.categories, candidate.tags, candidate.units, candidate.actions, candidate.blocks, candidate.activations || [], candidate.runs || [], candidate.occurrences || [], candidate.periods || [], candidate.actionLogs, candidate.history]) for (const item of collection) { if (!item?.id || ids.has(item.id)) throw new ImportError(`Duplicate or missing stable ID: ${item?.id || "unknown"}`); ids.add(item.id); }
    return { ok: true, state: candidate };
  } catch (error) { return { ok: false, error: error instanceof ImportError ? error : new ImportError(error.message || "Package validation failed.", { cause: error }) }; }
}
