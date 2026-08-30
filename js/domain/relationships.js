import { CircularReferenceError, ConflictError, ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";

export const RELATIONSHIP_KINDS = ["action", "block"];

export function createRelationship({
  id = null,
  parentBlockId,
  kind,
  refId,
  label = null,
  position = 0,
  config = {},
  now = new Date()
} = {}) {
  if (!parentBlockId || !RELATIONSHIP_KINDS.includes(kind) || !refId) {
    throw new ValidationError("Relationship requires a parent, kind and reference.");
  }
  const contextual = {
    required: false,
    allowSkip: false,
    requireSkipReason: false,
    allowExcuse: false,
    allowNotApplicable: false,
    includeInTarget: true,
    ...clone(config)
  };
  const stamp = new Date(now).toISOString();
  return {
    id: id || createId("relationship", now),
    parentBlockId,
    kind,
    refId,
    label: label == null ? null : String(label),
    position: Math.max(0, Number(position) || 0),
    config: contextual,
    createdAt: stamp,
    updatedAt: stamp
  };
}

export function updateRelationship(relationship, patch = {}, now = new Date()) {
  validateRelationship(relationship);
  const stamp = new Date(now).toISOString();
  const next = {
    ...relationship,
    ...clone(patch),
    id: relationship.id,
    parentBlockId: relationship.parentBlockId,
    kind: relationship.kind,
    refId: relationship.refId,
    config: { ...(relationship.config || {}), ...(clone(patch.config) || {}) },
    updatedAt: stamp
  };
  return next;
}

export function validateRelationship(relationship) {
  if (!relationship?.id || !relationship.parentBlockId || !RELATIONSHIP_KINDS.includes(relationship.kind) || !relationship.refId) {
    throw new ValidationError("Relationship is invalid.");
  }
  return true;
}

function validateParentSpecificRelationship(parent, relationship, blocksById) {
  const config = relationship.config || {};
  if (parent.type === "collection") {
    const unsupported = ["schedule", "timing", "deadline", "availableFrom", "completionMode", "dependsOn", "dependencyIds"];
    if (unsupported.some((key) => config[key] != null)) {
      throw new ValidationError("Collection relationships support references, labels, and manual order only.");
    }
  }
  if (parent.type === "cycle" && relationship.kind === "block") {
    const child = blocksById.get(relationship.refId);
    if (child?.type === "collection") {
      throw new ValidationError("Collection cannot be a Cycle execution slot.");
    }
    if (child && ["action_list", "routine", "workflow", "project", "cycle"].includes(child.type) && config.resolution === "never") {
      throw new ValidationError("Cycle child Blocks need a finite resolution event.");
    }
  }
  if (relationship.kind === "action" && parent.type === "collection" && (config.schedule || config.deadline)) {
    throw new ValidationError("Collection action relationships cannot be scheduled.");
  }
}

export function validateBlockGraph({ blocks = [], actions = [] } = {}) {
  const blockIds = new Set();
  const blocksById = new Map();
  for (const block of blocks) {
    if (!block?.id || blockIds.has(block.id)) throw new ConflictError(`Duplicate Block ID: ${block?.id || "unknown"}`);
    blockIds.add(block.id);
    blocksById.set(block.id, block);
  }
  const actionIds = new Set();
  for (const action of actions) {
    if (!action?.id || actionIds.has(action.id)) throw new ConflictError(`Duplicate Action ID: ${action?.id || "unknown"}`);
    actionIds.add(action.id);
  }

  const seenRelationshipIds = new Set();
  for (const block of blocks) {
    const keys = new Set();
    const contextualKeys = new Set();
    for (const relationship of block.relationships || []) {
      validateRelationship(relationship);
      validateParentSpecificRelationship(block, relationship, blocksById);
      if (relationship.parentBlockId !== block.id) throw new ValidationError("Relationship parent does not match its Block.");
      if (seenRelationshipIds.has(relationship.id)) throw new ConflictError(`Duplicate relationship ID: ${relationship.id}`);
      seenRelationshipIds.add(relationship.id);
      const key = `${relationship.kind}:${relationship.refId}`;
      const contextualLabel = relationship.label || relationship.config?.contextualLabel;
      if (contextualLabel) {
        const labelKey = `${key}:${String(contextualLabel).trim().toLocaleLowerCase()}`;
        if (contextualKeys.has(labelKey)) throw new ConflictError(`Duplicate contextual relationship: ${labelKey}`);
        contextualKeys.add(labelKey);
      }
      if (keys.has(key)) {
        if (block.type === "collection") throw new ConflictError(`Collection ${block.id} cannot contain duplicate references: ${relationship.refId}`);
        if (relationship.kind === "block") throw new ConflictError(`A Block may appear only once directly in ${block.id}: ${relationship.refId}`);
        const contextual = Boolean(relationship.label || relationship.config?.contextualLabel || relationship.config?.allowDuplicate);
        if (!contextual) throw new ConflictError(`Duplicate direct relationship: ${key}`);
      }
      keys.add(key);
      if (relationship.kind === "action" && !actionIds.has(relationship.refId)) {
        throw new ValidationError("Relationship references a missing Action.");
      }
      if (relationship.kind === "block" && !blockIds.has(relationship.refId)) {
        throw new ValidationError("Relationship references a missing Block.");
      }
      if (relationship.kind === "block" && relationship.refId === block.id) {
        throw new CircularReferenceError("A Block cannot contain itself.");
      }
    }
  }

  function visitRoot(rootId) {
    const seenInRoot = new Set();
    const visiting = new Set();
    function visit(id, path = []) {
      if (visiting.has(id)) throw new CircularReferenceError(`Circular Block reference: ${[...path, id].join(" → ")}`);
      if (seenInRoot.has(id)) {
        throw new ConflictError(`Block ${id} appears more than once within root ${rootId}.`);
      }
      seenInRoot.add(id);
      visiting.add(id);
      const block = blocksById.get(id);
      for (const relationship of block?.relationships || []) {
        if (relationship.kind === "block") visit(relationship.refId, [...path, id]);
      }
      visiting.delete(id);
    }
    visit(rootId);
  }

  // Run each definition as a possible root so a reusable Block remains legal
  // across independent roots while duplicates inside one executable tree fail.
  for (const block of blocks) visitRoot(block.id);
  return true;
}

export function getDescendantBlockIds(blockId, blocks = []) {
  const result = [];
  const seen = new Set([blockId]);
  function walk(id) {
    for (const relationship of blocks.find((block) => block.id === id)?.relationships || []) {
      if (relationship.kind === "block" && !seen.has(relationship.refId)) {
        seen.add(relationship.refId);
        result.push(relationship.refId);
        walk(relationship.refId);
      }
    }
  }
  walk(blockId);
  return result;
}

export function getRelationships(block, kind = null) {
  return (block?.relationships || [])
    .filter((relationship) => !kind || relationship.kind === kind)
    .sort((a, b) => a.position - b.position);
}
