import { StorageError } from "../shared/errors.js";
import { deepClone } from "../shared/validation.js";
import { ENGINE_BACKUP_KEY, STATE_KEY, readLocalCandidates, writeLocalMigrationBackup, writeLocalState } from "./local-storage.js";
import { readIndexedState, writeIndexedTransaction } from "./indexed-db.js";

function stateWeight(candidate) {
  return ["categories", "tags", "units", "actions", "blocks", "activationPresets", "activations", "runs", "occurrences", "actionLogs", "history", "analysisTargets", "targetPeriods", "avoidPeriods", "periodEvaluations", "restorePoints", "importHistory", "bin"]
    .reduce((total, key) => total + (Array.isArray(candidate?.[key]) ? candidate[key].length : 0), 0);
}

function stateTime(candidate) {
  const parsed = Date.parse(candidate?.meta?.updatedAt || candidate?.meta?.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectBestStateCandidate(candidates) {
  return [...candidates].filter((item) => item && item.value).sort((a, b) => {
    const weightDifference = stateWeight(b.value) - stateWeight(a.value);
    return weightDifference || stateTime(b.value) - stateTime(a.value);
  })[0] || null;
}

export class Repository {
  async getAction(id) { return (await this.getActions()).find((item) => item.id === id) || null; }
  async getActions() { return (await this.load())?.actions || []; }
  async saveAction(action) {
    return this.transaction((state) => {
      const index = state.actions.findIndex((item) => item.id === action.id);
      if (index < 0) state.actions.push(deepClone(action)); else state.actions[index] = deepClone(action);
      return deepClone(action);
    });
  }
  async getBlock(id) { return (await this.getBlocks()).find((item) => item.id === id) || null; }
  async getBlocks() { return (await this.load())?.blocks || []; }
  async saveBlock(block) {
    return this.transaction((state) => {
      const index = state.blocks.findIndex((item) => item.id === block.id);
      if (index < 0) state.blocks.push(deepClone(block)); else state.blocks[index] = deepClone(block);
      return deepClone(block);
    });
  }
  async getActionLogs(filter = {}) {
    return ((await this.load())?.actionLogs || []).filter((log) => (!filter.actionId || log.actionId === filter.actionId)
      && (!filter.from || new Date(log.timestamp || log.createdAt) >= new Date(filter.from))
      && (!filter.to || new Date(log.timestamp || log.createdAt) < new Date(filter.to)));
  }
  async saveActionLog(log) {
    return this.transaction((state) => {
      const index = state.actionLogs.findIndex((item) => item.id === log.id);
      if (index < 0) state.actionLogs.push(deepClone(log)); else state.actionLogs[index] = deepClone(log);
      return deepClone(log);
    });
  }
}

function browserCapability(name) {
  try { return globalThis?.[name] || null; }
  catch { return null; }
}

export class LegacyBrowserRepository extends Repository {
  constructor({ indexedDBApi, localStorageApi, logger = null } = {}) {
    super();
    this.indexedDB = indexedDBApi === undefined ? browserCapability("indexedDB") : indexedDBApi;
    this.localStorage = localStorageApi === undefined ? browserCapability("localStorage") : localStorageApi;
    this.logger = logger;
  }

  async load() {
    const candidates = readLocalCandidates(this.localStorage);
    try {
      const value = await readIndexedState(this.indexedDB, STATE_KEY);
      if (value) candidates.push({ source: `indexedDB:${STATE_KEY}`, value });
    } catch (error) { this.logger?.debug("Storage", "IndexedDB read unavailable; using fallback.", { message: error.message }); }
    const selected = selectBestStateCandidate(candidates);
    return selected ? deepClone(selected.value) : null;
  }

  async createMigrationBackup(state) {
    if (!state) return;
    let saved = false;
    const failures = [];
    try { writeLocalMigrationBackup(this.localStorage, state); saved = Boolean(this.localStorage); } catch (error) { failures.push(error); }
    try { await writeIndexedTransaction(this.indexedDB, [[ENGINE_BACKUP_KEY, deepClone(state)]]); saved = true; }
    catch (error) { failures.push(error); }
    if (!saved) throw new StorageError("Could not create a pre-migration backup.", { causes: failures.map((error) => error.message) });
    if (failures.length) this.logger?.debug("Storage", "One backup adapter was unavailable; another retained the backup.", { causes: failures.map((error) => error.message) });
  }

  async save(state, previous = null) {
    const snapshot = deepClone(state);
    let saved = false;
    const failures = [];
    try {
      const entries = previous ? [[ENGINE_BACKUP_KEY, deepClone(previous)], [STATE_KEY, snapshot]] : [[STATE_KEY, snapshot]];
      await writeIndexedTransaction(this.indexedDB, entries);
      saved = true;
    } catch (error) { failures.push(error); }
    try { writeLocalState(this.localStorage, snapshot, previous); saved = saved || Boolean(this.localStorage); }
    catch (error) { failures.push(error); }
    if (!saved) throw new StorageError("Could not persist SAMT state.", { causes: failures.map((error) => error.message) });
    if (failures.length) this.logger?.debug("Storage", "One storage adapter was unavailable; another committed the state.", { causes: failures.map((error) => error.message) });
    return snapshot;
  }

  async transaction(callback) {
    const current = await this.load();
    const candidate = deepClone(current);
    const value = await callback(candidate);
    await this.save(candidate, current);
    return { state: candidate, value };
  }
}

export class MemoryRepository extends Repository {
  constructor(initialState = null) { super(); this.state = initialState ? deepClone(initialState) : null; this.backups = []; }
  async load() { return this.state ? deepClone(this.state) : null; }
  async createMigrationBackup(state) { this.backups.push(deepClone(state)); }
  async save(state) { this.state = deepClone(state); return this.load(); }
  async transaction(callback) {
    const candidate = deepClone(this.state);
    const value = await callback(candidate);
    this.state = candidate;
    return { state: deepClone(candidate), value };
  }
}
