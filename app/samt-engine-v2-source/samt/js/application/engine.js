import { StorageError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { deepClone } from "../shared/validation.js";
import { runLogicalTransaction } from "../infrastructure/transactions.js";
import { migrateInternalState, validateLegacyShape } from "../import-export/migrations.js";
import { validateState } from "../import-export/validator.js";
import { exportFullBackup, exportActionPackage, exportBlockPackage, exportStylePackage } from "../import-export/exporter.js";
import { prepareImport, rebuildImportCandidate } from "../import-export/importer.js";
import { createBackupRecord } from "../infrastructure/backup.js";
import { reconcileTemporalState } from "./lifecycle.js";
import { EventCollector, EVENTS, StructuredLogger, domainEvent } from "./events.js";
import { createQueries } from "./queries.js";
import {
  activateBlockCommand, advanceCycleCommand, commandContext, completeOccurrenceCommand, createActionCommand, createBlockCommand,
  deleteActionLogCommand, finishRunCommand, logActionCommand, moveDefinitionToBinCommand, pauseBlockCommand, startRunCommand,
  startPeriodCommand, closePeriodCommand, updateActionCommand, updateBlockCommand
} from "./commands.js";

export class SamtEngine {
  constructor({ repository, clock, timezone = "Europe/London", idFactory = createId, logger = new StructuredLogger(false) }) {
    this.repository = repository;
    this.clock = clock;
    this.timezone = timezone;
    this.idFactory = idFactory;
    this.logger = logger;
    this.events = new EventCollector();
    this.state = null;
    this.queries = createQueries(() => deepClone(this.state), () => ({ now: this.clock.now(), timezone: this.state?.settings?.timezone || this.timezone }));
  }

  async initialize() {
    const raw = await this.repository.load();
    const legacyValidation = validateLegacyShape(raw || {});
    if (raw && !legacyValidation.ok) throw new StorageError("Existing SAMT data failed pre-migration validation. Nothing was changed.", legacyValidation);
    if (raw) await this.repository.createMigrationBackup(raw);
    const migration = migrateInternalState(raw, { now: this.clock.now(), timezone: this.timezone });
    try {
      validateState(migration.state);
      const reconciled = reconcileTemporalState(migration.state, { now: this.clock.now(), timezone: migration.state.settings.timezone });
      validateState(reconciled.state);
      await this.repository.save(reconciled.state, raw);
      this.state = reconciled.state;
      reconciled.events.forEach((event) => this.events.emit(event));
      return { ok: true, value: this.queries.getState(), migrated: migration.changed, fresh: migration.fresh };
    } catch (error) {
      this.state = raw ? deepClone(raw) : null;
      throw new StorageError("SAMT migration was not committed. The original state remains available.", { cause: error.message, code: error.code });
    }
  }

  context() { return commandContext(this.clock.now(), this.idFactory, this.state?.settings?.timezone || this.timezone); }

  async transact(mutation) {
    if (!this.state) throw new StorageError("SAMT engine is not initialised.");
    const context = this.context();
    const outcome = await runLogicalTransaction({
      state: this.state,
      mutate: async (candidate) => {
        const result = await mutation(candidate, context);
        candidate.meta = { ...(candidate.meta || {}), updatedAt: context.now };
        return result;
      },
      validate: validateState,
      commit: (candidate, previous) => this.repository.save(candidate, previous)
    });
    this.state = outcome.state;
    for (const event of outcome.value?.events || []) this.events.emit(event);
    return { ok: true, value: deepClone(outcome.value?.value), events: deepClone(outcome.value?.events || []) };
  }

  createAction(input) { return this.transact((state, context) => createActionCommand(state, input, context)); }
  updateAction(id, patch) { return this.transact((state, context) => updateActionCommand(state, id, patch, context)); }
  logAction(id, input) { return this.transact((state, context) => logActionCommand(state, id, input, context)); }
  deleteActionLog(id) { return this.transact((state, context) => deleteActionLogCommand(state, id, context)); }
  createBlock(input) { return this.transact((state, context) => createBlockCommand(state, input, context)); }
  updateBlock(id, patch) { return this.transact((state, context) => updateBlockCommand(state, id, patch, context)); }
  activateBlock(id, config = {}) { return this.transact((state, context) => activateBlockCommand(state, id, config, context)); }
  pauseBlock(id, resumeAt) { return this.transact((state, context) => pauseBlockCommand(state, id, resumeAt, context)); }
  startRun(blockId, activationId = null) { return this.transact((state, context) => startRunCommand(state, blockId, activationId, context)); }
  finishRun(id) { return this.transact((state, context) => finishRunCommand(state, id, context)); }
  completeOccurrence(id, status = "completed") { return this.transact((state, context) => completeOccurrenceCommand(state, id, status, context)); }
  skipOccurrence(id) { return this.completeOccurrence(id, "skipped"); }
  advanceCycle(id) { return this.transact((state, context) => advanceCycleCommand(state, id, context)); }
  startPeriod(blockId) { return this.transact((state, context) => startPeriodCommand(state, blockId, context)); }
  closePeriod(periodId) { return this.transact((state, context) => closePeriodCommand(state, periodId, context)); }
  deleteDefinition(kind, id) { return this.transact((state, context) => moveDefinitionToBinCommand(state, kind, id, context)); }

  async reconcileTemporalState() {
    return this.transact((state, context) => {
      const outcome = reconcileTemporalState(state, { now: context.now, timezone: state.settings.timezone || this.timezone });
      return { value: { eventCount: outcome.events.length }, events: outcome.events };
    });
  }

  makePackage(type, rootIds = []) {
    const options = { id: this.idFactory("package"), now: this.clock.now() };
    if (type === "backup") return exportFullBackup(this.state, options);
    if (type === "action-package") return exportActionPackage(this.state, rootIds, options);
    if (type === "block-package") return exportBlockPackage(this.state, rootIds, options);
    if (type === "style-package") return exportStylePackage(this.state, rootIds, options);
    throw new Error(`Unsupported package type: ${type}`);
  }

  prepareImport(input) { return prepareImport(this.state, input); }

  async commitImport(preview) {
    return this.transact((state, context) => {
      const restorePoint = createBackupRecord(state, { id: context.id("restore"), now: context.now, reason: `Before ${preview.package.packageType} import`, packageId: preview.package.packageId });
      const candidate = rebuildImportCandidate(state, preview);
      candidate.restorePoints = [...(candidate.restorePoints || []), restorePoint];
      candidate.importHistory = [...(candidate.importHistory || []), { id: context.id("import"), packageId: preview.package.packageId, packageType: preview.package.packageType, importedAt: context.now, status: "completed", restorePointId: restorePoint.id }];
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, candidate);
      const event = domainEvent(EVENTS.IMPORT_PERFORMED, { packageId: preview.package.packageId, restorePointId: restorePoint.id }, context.now);
      return { value: { restorePointId: restorePoint.id }, events: [event] };
    });
  }

  async undoImport(restorePointId) {
    return this.transact((state, context) => {
      const restore = state.restorePoints.find((item) => item.id === restorePointId);
      if (!restore) throw new StorageError("Import Restore Point was not found.");
      const restored = deepClone(restore.snapshot);
      restored.importHistory = [...(restored.importHistory || []), { id: context.id("import"), packageId: restore.packageId, packageType: "undo", importedAt: context.now, status: "undone" }];
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, restored);
      return { value: true, events: [domainEvent(EVENTS.IMPORT_UNDONE, { restorePointId }, context.now)] };
    });
  }

  setAppearanceMode(mode) {
    return this.transact((state, context) => { state.settings.appearanceMode = ["light", "dark", "system"].includes(mode) ? mode : "system"; state.settings.updatedAt = context.now; return { value: state.settings.appearanceMode, events: [] }; });
  }
}
