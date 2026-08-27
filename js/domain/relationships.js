import { CircularReferenceError, ConflictError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";

export const RELATIONSHIP_KINDS = ["action", "block"];

export function createRelationship({ id = null, parentBlockId, kind, refId, label = null, position = 0, config = {}, now = new Date() } = {}) {
  if (!parentBlockId || !RELATIONSHIP_KINDS.includes(kind) || !refId) throw new ValidationError("Relationship requires a parent, kind and reference.");
  const contextual = { required: false, allowSkip: false, requireSkipReason: false, includeInTarget: true, ...clone(config) };
  return { id: id || createId("relationship", now), parentBlockId, kind, refId, label: label == null ? null : String(label), position: Math.max(0, Number(position) || 0), config: contextual, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}

export function validateRelationship(relationship) {
  if (!relationship?.id || !relationship.parentBlockId || !RELATIONSHIP_KINDS.includes(relationship.kind) || !relationship.refId) throw new ValidationError("Relationship is invalid.");
  return true;
}

export function validateBlockGraph({ blocks = [], actions = [] } = {}) {
  const blockIds = new Set(); for (const block of blocks) { if (!block?.id || blockIds.has(block.id)) throw new ConflictError(`Duplicate Block ID: ${block?.id || "unknown"}`); blockIds.add(block.id); }
  const actionIds = new Set(); for (const action of actions) { if (!action?.id || actionIds.has(action.id)) throw new ConflictError(`Duplicate Action ID: ${action?.id || "unknown"}`); actionIds.add(action.id); }
  const seenRelationshipIds = new Set();
  for (const block of blocks) {
    const keys = new Set(); const contextualLabels = new Set();
    for (const relationship of block.relationships || []) {
      validateRelationship(relationship);
      if (relationship.parentBlockId !== block.id) throw new ValidationError("Relationship parent does not match its Block.");
      if (seenRelationshipIds.has(relationship.id)) throw new ConflictError(`Duplicate relationship ID: ${relationship.id}`);
      seenRelationshipIds.add(relationship.id);
      const key = `${relationship.kind}:${relationship.refId}`;
      const contextualLabel = relationship.label || relationship.config?.contextualLabel;
      if (contextualLabel) { const labelKey = `${key}:${String(contextualLabel).trim().toLocaleLowerCase()}`; if (contextualLabels.has(labelKey)) throw new ConflictError(`Duplicate contextual relationship: ${labelKey}`); contextualLabels.add(labelKey); }
      if (keys.has(key)) {
        if (relationship.kind === "block") throw new ConflictError(`A Block may appear only once directly in ${block.id}: ${relationship.refId}`);
        const contextual = relationship.label || relationship.config?.contextualLabel || relationship.config?.allowDuplicate;
        const alreadyContextual = [...(block.relationships || [])].some((candidate) => candidate !== relationship && candidate.kind === relationship.kind && candidate.refId === relationship.refId && (candidate.label || candidate.config?.contextualLabel || candidate.config?.allowDuplicate));
        if (!contextual || !alreadyContextual) throw new ConflictError(`Duplicate direct relationship: ${key}`);
      }
      keys.add(key);
      if (relationship.kind === "action" && !actionIds.has(relationship.refId)) throw new ValidationError("Relationship references a missing Action.");
      if (relationship.kind === "block" && !blockIds.has(relationship.refId)) throw new ValidationError("Relationship references a missing Block.");
      if (relationship.kind === "block" && relationship.refId === block.id) throw new CircularReferenceError("A Block cannot contain itself.");
    }
  }
  const visiting = new Set(); const visited = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) throw new CircularReferenceError(`Circular Block reference: ${[...path, id].join(" → ")}`);
    if (visited.has(id)) return; visiting.add(id);
    const block = blocks.find((item) => item.id === id);
    for (const relationship of block?.relationships || []) if (relationship.kind === "block") visit(relationship.refId, [...path, id]);
    visiting.delete(id); visited.add(id);
  }
  for (const block of blocks) visit(block.id);
  return true;
}

export function getDescendantBlockIds(blockId, blocks = []) {
  const result = []; const seen = new Set([blockId]);
  function walk(id) { for (const relationship of blocks.find((block) => block.id === id)?.relationships || []) if (relationship.kind === "block" && !seen.has(relationship.refId)) { seen.add(relationship.refId); result.push(relationship.refId); walk(relationship.refId); } }
  walk(blockId); return result;
}

export function getRelationships(block, kind = null) { return (block?.relationships || []).filter((relationship) => !kind || relationship.kind === kind).sort((a, b) => a.position - b.position); }
