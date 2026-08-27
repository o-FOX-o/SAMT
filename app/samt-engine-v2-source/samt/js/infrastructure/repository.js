import { StorageError } from "../shared/errors.js";
import { deepClone } from "../shared/validation.js";
import { STATE_KEY, migrationBackupKey, readLocalCandidates, writeLocalMigrationBackup, writeLocalState } from "./local-storage.js";
import { readIndexedState, writeIndexedTransaction } from "./indexed-db.js";

function stateWeight(candidate) {
  return ["categories", "tags", "units", "actions", "blocks", "activationPresets", "activations", "runs", "occurrences", "actionLogs", "history", "analysisTargets", "targetPeriods", "avoidPeriods", "periodEvaluations", "restorePoints", "importHistory", "bin"]
    .reduce((total, key) => total + (Array.isArray(candidate?.[key]) ? candidate[key].length : 0), 0);
}

function stateTime(candidate) {
  const parsed = Date.parse(candidate?.meta?.updatedAt || candidate?.meta?.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourcePriority(source = "") {
  if (source.startsWith("indexedDB:")) return 4;
  if (source.endsWith(STATE_KEY)) return 3;
  if (source.includes("fallback")) return 2;
  if (source.includes("recovery")) return 1;
  return 0;
}

export function selectBestStateCandidate(candidates) {
  return [...candidates].filter((item) => item && item.value).sort((a, b) => {
    const aTime = stateTime(a.value);
    const bTime = stateTime(b.value);
    if (aTime || bTime) {
      const timeDifference = bTime - aTime;
      if (timeDifference) return timeDifference;
    }
    const sourceDifference = sourcePriority(b.source) - sourcePriority(a.source);
    if (sourceDifference) return sourceDifference;
    return stateWeight(b.value) - stateWeight(a.value);
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

  async createMigrationBackup(state, { targetVersion = 2 } = {}) {
    if (!state) return;
    const backupKey = migrationBackupKey(targetVersion);
    let saved = false;
    const failures = [];
    try { writeLocalMigrationBackup(this.localStorage, state, backupKey); saved = Boolean(this.localStorage); } catch (error) { failures.push(error); }
    try {
      const existing = await readIndexedState(this.indexedDB, backupKey);
      if (!existing) await writeIndexedTransaction(this.indexedDB, [[backupKey, deepClone(state)]]);
      saved = true;
    }
    catch (error) { failures.push(error); }
    if (!saved) throw new StorageError("Could not create a pre-migration backup.", { causes: failures.map((error) => error.message) });
    if (failures.length) this.logger?.debug("Storage", "One backup adapter was unavailable; another retained the backup.", { causes: failures.map((error) => error.message) });
  }

  async save(state, previous = null) {
    const snapshot = deepClone(state);
    let saved = false;
    const failures = [];
    try {
      await writeIndexedTransaction(this.indexedDB, [[STATE_KEY, snapshot]]);
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
  constructor(initialState = null) { super(); this.state = initialState ? deepClone(initialState) : null; this.backups = []; this.backupVersions = new Set(); }
  async load() { return this.state ? deepClone(this.state) : null; }
  async createMigrationBackup(state, { targetVersion = 2 } = {}) {
    if (!this.backupVersions.has(targetVersion)) {
      this.backupVersions.add(targetVersion);
      this.backups.push(deepClone(state));
    }
  }
  async save(state) { this.state = deepClone(state); return this.load(); }
  async transaction(callback) {
    const candidate = deepClone(this.state);
    const value = await callback(candidate);
    this.state = candidate;
    return { state: deepClone(candidate), value };
  }
}
