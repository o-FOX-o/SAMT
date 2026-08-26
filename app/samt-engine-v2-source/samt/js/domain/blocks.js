import { InvalidTargetError, ValidationError } from "../shared/errors.js";
import { normalizeName } from "../shared/validation.js";

export const BLOCK_TYPES = ["cycle", "routine", "workflow", "project", "action_list", "collection", "target"];
export const BLOCK_LIFECYCLE = ["library", "active", "paused", "archived"];

export function normalizeBlockDefinition(block) {
  const type = BLOCK_TYPES.includes(block.type) ? block.type : (block.completion && block.completion.mode === "open" ? "action_list" : "routine");
  return {
    ...block,
    type,
    name: normalizeName(block.name),
    direction: block.direction === "avoid" ? "avoid" : "do",
    children: Array.isArray(block.children) ? block.children.map((child, index) => ({ ...child, order: child.order ?? index })) : [],
    completion: block.completion || { mode: ["action_list", "collection"].includes(type) ? "open" : "manual", threshold: 0, requiredRelIds: [], afterThreshold: "allow_extra" },
    typeConfig: block.typeConfig || {},
    projectTargets: Array.isArray(block.projectTargets) ? block.projectTargets : [],
    status: BLOCK_LIFECYCLE.includes(block.status) ? block.status : "active"
  };
}

export function validateBlockDefinition(input) {
  const block = normalizeBlockDefinition(input);
  if (!block.id || typeof block.id !== "string") throw new ValidationError("Block needs a stable ID.");
  if (!block.name) throw new ValidationError("Block name is required.");
  if (!BLOCK_TYPES.includes(block.type)) throw new ValidationError("Block type is invalid.");
  if (!BLOCK_LIFECYCLE.includes(block.status)) throw new ValidationError("Block lifecycle state is invalid.");
  const relationIds = new Set();
  for (const child of block.children) {
    if (!child || typeof child.id !== "string" || !child.id) throw new ValidationError("Every child relationship needs a stable ID.");
    if (relationIds.has(child.id)) throw new ValidationError("Child relationship IDs must be unique inside a Block.");
    relationIds.add(child.id);
    if (!["action", "block"].includes(child.kind) || typeof child.refId !== "string") throw new ValidationError("A Block child relationship is invalid.");
    if (block.type === "cycle" && (!(Number(child.frequency ?? 1) >= 1) || !Number.isInteger(Number(child.frequency ?? 1)))) throw new ValidationError("Cycle frequency must be a whole number of at least 1.");
  }
  const required = block.completion.requiredRelIds || [];
  if (required.some((id) => !relationIds.has(id))) throw new ValidationError("Required children must be direct Block children.");
  if (block.type === "target") {
    const config = block.typeConfig || {};
    const metric = config.targetMetric || "time";
    if (!['time', 'quantity', 'completion_count'].includes(metric)) throw new InvalidTargetError("Target metric is invalid.");
    if (!(Number(config.targetValue) > 0)) throw new InvalidTargetError("Target value must be greater than zero.");
  }
  return block;
}

export function createBlockDefinition(input, { id, now }) {
  return validateBlockDefinition({ ...input, id, createdAt: now, updatedAt: now, status: input.status || "active" });
}

export function updateBlockDefinition(existing, patch, now) {
  if (!existing) throw new ValidationError("Existing Block is required.");
  return validateBlockDefinition({ ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: now });
}

export function isExecutableBlock(block) { return block && !["collection", "action_list"].includes(block.type); }
