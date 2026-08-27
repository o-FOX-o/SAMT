import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone, requireName } from "../shared/validation.js";

export const BLOCK_TYPES = ["collection", "action_list", "routine", "workflow", "project", "cycle", "target"];
export const DEFINITION_STATUSES = ["LIBRARY", "ACTIVE", "PAUSED", "ARCHIVED"];
export const RUNTIME_STATUSES = ["NOT_STARTED", "AVAILABLE", "IN_PROGRESS", "READY_TO_FINISH", "COMPLETED", "PARTIAL", "MISSED", "EXPIRED", "OVERDUE", "SKIPPED", "PAUSED", "CANCELLED", "BLOCKED", "LOCKED", "NOT_APPLICABLE", "EXCUSED"];

export function createBlock({ id = null, type, name, description = "", definitionStatus = "LIBRARY", relationships = [], config = {}, now = new Date() } = {}) {
  if (!BLOCK_TYPES.includes(type)) throw new ValidationError("Block type is invalid.");
  if (!DEFINITION_STATUSES.includes(definitionStatus)) throw new ValidationError("Block definition status is invalid.");
  const stamp = new Date(now).toISOString();
  return { id: id || createId("block", now), type, name: requireName(name, "Block name"), description: String(description || ""), definitionStatus, relationships: clone(relationships) || [], config: clone(config) || {}, createdAt: stamp, updatedAt: stamp };
}

export function validateBlock(block) {
  if (!block?.id || !BLOCK_TYPES.includes(block.type) || !requireName(block.name, "Block name")) throw new ValidationError("Block is invalid.");
  if (!DEFINITION_STATUSES.includes(block.definitionStatus)) throw new ValidationError("Block definition status is invalid.");
  if (!Array.isArray(block.relationships)) throw new ValidationError("Block relationships must be an array.");
  return true;
}

export function setDefinitionStatus(block, status, now = new Date()) {
  if (!DEFINITION_STATUSES.includes(status)) throw new ValidationError("Block definition status is invalid.");
  return { ...block, definitionStatus: status, updatedAt: new Date(now).toISOString() };
}

export function isExecutableBlockType(type) { return ["action_list", "routine", "workflow", "project", "cycle"].includes(type); }
