import { CircularReferenceError, ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";

function indexById(items) { return new Map((items || []).map((item) => [item.id, item])); }

export function getBlockChildren(state, blockId) {
  const block = (state.blocks || []).find((item) => item.id === blockId);
  if (!block) throw new NotFoundError(`Block not found: ${blockId}`);
  const actions = indexById(state.actions);
  const blocks = indexById(state.blocks);
  return (block.children || []).map((relationship) => ({ relationship, object: relationship.kind === "action" ? actions.get(relationship.refId) : blocks.get(relationship.refId) })).filter((item) => item.object);
}

export function getDescendantBlockIds(state, rootBlockId, includeRoot = false) {
  const blocks = indexById(state.blocks);
  if (!blocks.has(rootBlockId)) throw new NotFoundError(`Block not found: ${rootBlockId}`);
  const output = new Set(includeRoot ? [rootBlockId] : []);
  const stack = [rootBlockId];
  while (stack.length) {
    const id = stack.pop();
    const block = blocks.get(id);
    for (const child of block.children || []) {
      if (child.kind !== "block" || output.has(child.refId)) continue;
      output.add(child.refId);
      stack.push(child.refId);
    }
  }
  if (!includeRoot) output.delete(rootBlockId);
  return output;
}

export function getDescendantActionIds(state, rootBlockId, direct = false) {
  const blocks = indexById(state.blocks);
  if (!blocks.has(rootBlockId)) throw new NotFoundError(`Block not found: ${rootBlockId}`);
  const output = new Set();
  const visitedBlocks = new Set();
  const stack = [rootBlockId];
  while (stack.length) {
    const id = stack.pop();
    if (visitedBlocks.has(id)) continue;
    visitedBlocks.add(id);
    const block = blocks.get(id);
    for (const child of block.children || []) {
      if (child.kind === "action") output.add(child.refId);
      else if (!direct && child.kind === "block") stack.push(child.refId);
    }
  }
  return output;
}

export function getBlocksContainingAction(state, actionId, activeOnly = true) {
  return (state.blocks || []).filter((block) => (!activeOnly || block.status === "active") && getDescendantActionIds(state, block.id).has(actionId));
}

export function validateBlockGraph(state) {
  const actions = indexById(state.actions);
  const blocks = indexById(state.blocks);
  const childBlockIds = new Set();
  for (const block of blocks.values()) {
    const directActions = new Set();
    const directBlocks = new Set();
    for (const child of block.children || []) {
      if (child.kind === "action") {
        if (!actions.has(child.refId)) throw new NotFoundError(`Block ${block.name} references a missing Action.`, { blockId: block.id, actionId: child.refId });
        if (directActions.has(child.refId)) throw new ConflictError(`${actions.get(child.refId).name} cannot appear twice directly inside ${block.name}.`);
        directActions.add(child.refId);
      } else if (child.kind === "block") {
        if (!blocks.has(child.refId)) throw new NotFoundError(`Block ${block.name} references a missing Block.`, { blockId: block.id, childBlockId: child.refId });
        if (directBlocks.has(child.refId)) throw new ConflictError(`${blocks.get(child.refId).name} cannot appear twice directly inside ${block.name}.`);
        directBlocks.add(child.refId);
        childBlockIds.add(child.refId);
      } else throw new ValidationError("Block child kind must be action or block.");
    }
  }

  const visit = (id, path, visiting) => {
    if (visiting.has(id)) {
      const names = [...path, id].map((item) => blocks.get(item)?.name || item);
      throw new CircularReferenceError(`Circular Block reference: ${names.join(" → ")}`, { path: [...path, id] });
    }
    const nextVisiting = new Set(visiting).add(id);
    for (const child of blocks.get(id).children || []) if (child.kind === "block") visit(child.refId, [...path, id], nextVisiting);
  };
  for (const id of blocks.keys()) visit(id, [], new Set());

  const roots = [...blocks.keys()].filter((id) => !childBlockIds.has(id));
  for (const rootId of roots) {
    const seen = new Map();
    const walk = (id, path) => {
      if (seen.has(id)) {
        const name = blocks.get(id).name;
        const existing = seen.get(id).map((item) => blocks.get(item)?.name || item).join(" → ");
        throw new ConflictError(`${name} cannot be added. It already exists at: ${existing}`, { rootId, blockId: id, existingPath: seen.get(id), rejectedPath: [...path, id] });
      }
      const currentPath = [...path, id];
      seen.set(id, currentPath);
      for (const child of blocks.get(id).children || []) if (child.kind === "block") walk(child.refId, currentPath);
    };
    walk(rootId, []);
  }
  return true;
}
