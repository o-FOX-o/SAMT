import { clone } from "../shared/validation.js";
import { NotFoundError, StorageError } from "../shared/errors.js";

export function createRepository({ state, persist = () => true } = {}) {
  let current = clone(state || {});
  const repository = {
    getState: () => current,
    replaceState(next, options = {}) { current = clone(next); if (options.persist !== false) persist(current); return current; },
    persist: () => persist(current),
    getAction: (id) => current.actions?.find((item) => item.id === id) || null,
    getActions: () => [...(current.actions || [])],
    saveAction(action) { const index = current.actions.findIndex((item) => item.id === action.id); if (index < 0) current.actions.push(clone(action)); else current.actions[index] = clone(action); return action; },
    getBlock: (id) => current.blocks?.find((item) => item.id === id) || null,
    getBlocks: () => [...(current.blocks || [])],
    saveBlock(block) { const index = current.blocks.findIndex((item) => item.id === block.id); if (index < 0) current.blocks.push(clone(block)); else current.blocks[index] = clone(block); return block; },
    getActionLogs: (filter = null) => (current.actionLogs || []).filter(filter || (() => true)).map(clone),
    saveActionLog(log) { const index = current.actionLogs.findIndex((item) => item.id === log.id); if (index < 0) current.actionLogs.push(clone(log)); else current.actionLogs[index] = clone(log); return log; },
    transaction(callback) { const before = clone(current); try { const value = callback(repository); persist(current); return value; } catch (error) { current = before; throw error; } },
    requireAction(id) { const item = repository.getAction(id); if (!item) throw new NotFoundError(`Action not found: ${id}`); return item; },
    requireBlock(id) { const item = repository.getBlock(id); if (!item) throw new NotFoundError(`Block not found: ${id}`); return item; }
  };
  return repository;
}

export function memoryRepository(state) { return createRepository({ state, persist: () => true }); }
