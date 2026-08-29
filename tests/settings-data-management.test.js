import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyState } from "../js/application/normalization.js";
import { memoryRepository } from "../js/infrastructure/repository.js";
import { fakeClock } from "../js/infrastructure/clock.js";
import { createEngine } from "../js/application/engine.js";
import { clone } from "../js/shared/validation.js";
import { BUILTIN_UNITS } from "../js/domain/units.js";
import { exportActionPackage, exportBlockPackage, exportPackage, packageCounts } from "../js/import-export/exporter.js";
import { previewImport } from "../js/import-export/importer.js";
import { validatePackage } from "../js/import-export/validator.js";
import { renderSettingsView } from "../js/ui/settings-view.js";

function makeEngine(date = "2026-08-29T01:43:00Z") {
  const clock = fakeClock(new Date(date), "UTC");
  const repository = memoryRepository(createEmptyState(clock.now()));
  return { clock, repository, engine: createEngine({ repository, clock }) };
}

function addActionFixture(engine, { withResult = false } = {}) {
  const category = engine.commands.createCategory({ id: "category_fitness", name: "Fitness" });
  const actionTag = engine.commands.createTag({ id: "tag_strength", categoryId: category.id, name: "Strength", scope: "action" });
  const action = engine.commands.createAction({ id: "action_press", name: "Bench Press", description: "Strength training", tagIds: [actionTag.id], completion: { method: "quantity", target: 8 } });
  let resultTag = null; let unit = null; let field = null;
  if (withResult) {
    resultTag = engine.commands.createTag({ id: "tag_measurement", categoryId: category.id, name: "Measurement", scope: "result" });
    unit = engine.commands.createUnit({ id: "unit_custom_kg", name: "Training Kilogram", symbol: "tkg", dimension: "mass", baseUnitId: "unit_kg", factor: 1 });
    field = engine.commands.addResultField(action.id, { id: "result_load", type: "measurement", label: "Load", resultTagId: resultTag.id, config: { defaultUnitId: unit.id, allowedUnitIds: [unit.id] } });
  }
  return { category, actionTag, action, resultTag, unit, field };
}

test("General, Capacity and Defaults settings persist without rewriting factual timestamps", () => {
  const { engine, repository } = makeEngine();
  const action = engine.commands.createAction({ id: "action_settings", name: "Journal" });
  engine.commands.logAction({ id: "log_settings", actionId: action.id, eventAt: "2026-08-27T12:00:00Z", durationMinutes: 20 });
  const originalEventAt = repository.getState().actionLogs[0].eventAt;

  engine.commands.updateSettings({
    timezone: "Asia/Tokyo",
    weekStartsOn: 0,
    capacity: { availableMinutes: 480, periodDays: 30 },
    defaults: { targetAutoClose: false, cycleAutoClose: true, routineExpire: false, actionListExpire: true }
  });

  assert.equal(repository.getState().settings.timezone, "Asia/Tokyo");
  assert.equal(repository.getState().settings.weekStartsOn, 0);
  assert.deepEqual(repository.getState().settings.capacity, { availableMinutes: 480, periodDays: 30, updatedAt: repository.getState().settings.capacity.updatedAt });
  assert.equal(repository.getState().settings.defaults.targetAutoClose, false);
  assert.equal(repository.getState().settings.defaults.routineExpire, false);
  assert.equal(repository.getState().actionLogs[0].eventAt, originalEventAt);
  assert.throws(() => engine.commands.updateSettings({ timezone: "Not/A_Timezone" }), /not recognised/);
});

test("Data Manager searches derived labels and separates active usage from History", () => {
  const { engine } = makeEngine();
  const fixture = addActionFixture(engine);
  const unused = engine.commands.createAction({ id: "action_unused", name: "Unused Action" });
  const routine = engine.commands.createBlock({ id: "block_chest", type: "routine", name: "Chest Routine", definitionStatus: "ACTIVE" });
  const relationship = engine.commands.addRelationship(routine.id, { id: "relationship_press", kind: "action", refId: fixture.action.id, label: "Press" });
  const occurrence = engine.commands.createOccurrence({ id: "occurrence_press", relationshipId: relationship.id, deadline: "2026-08-30T00:00:00Z" });
  engine.commands.logAction({ id: "log_press", actionId: fixture.action.id, eventAt: "2026-08-27T12:00:00Z", quantity: 8, contextRefs: [{ occurrenceId: occurrence.id }] });

  const search = engine.queries.getDataManagerRecords({ search: "strength" });
  assert.ok(search.records.some((record) => record.type === "action" && record.id === fixture.action.id));
  assert.ok(search.records.some((record) => record.type === "tag" && record.id === fixture.actionTag.id));
  const used = engine.queries.getDataManagerRecords({ type: "action", usage: "active_references" });
  assert.deepEqual(used.records.map((record) => record.id), [fixture.action.id]);
  const history = engine.queries.getDataManagerRecords({ type: "action", history: "has_history" });
  assert.ok(history.records.some((record) => record.id === fixture.action.id));
  const unusedRecords = engine.queries.getDataManagerRecords({ type: "action", usage: "unused" });
  assert.deepEqual(unusedRecords.records.map((record) => record.id), [unused.id]);
  assert.ok(engine.queries.getDataManagerRecords({ type: "actionLog", dateFilter: "before", before: "2026-08-28" }).records.some((record) => record.id === "log_press"));
});

test("Archive is reversible and preserves live references and History", () => {
  const { engine } = makeEngine();
  const { action } = addActionFixture(engine);
  const block = engine.commands.createBlock({ id: "block_archive", type: "routine", name: "Archive Routine" });
  engine.commands.addRelationship(block.id, { id: "relationship_archive", kind: "action", refId: action.id });

  engine.commands.archiveDefinitions([{ type: "action", id: action.id }]);
  assert.equal(engine.getState().actions.find((item) => item.id === action.id).status, "archived");
  assert.equal(engine.getState().blocks[0].relationships[0].refId, action.id);
  assert.ok(engine.getState().history.length > 0);
  engine.commands.unarchiveDefinitions([{ type: "action", id: action.id }]);
  assert.equal(engine.getState().actions.find((item) => item.id === action.id).status, "active");
  assert.equal("archivedFromStatus" in engine.getState().actions.find((item) => item.id === action.id), false);
});

test("Dependency-aware Bin operations preserve stable IDs and historical snapshots", () => {
  const { engine, repository } = makeEngine();
  const fixture = addActionFixture(engine);
  const block = engine.commands.createBlock({ id: "block_bin", type: "routine", name: "Bin Routine", definitionStatus: "ACTIVE" });
  const relationship = engine.commands.addRelationship(block.id, { id: "relationship_bin", kind: "action", refId: fixture.action.id });
  const occurrence = engine.commands.createOccurrence({ id: "occurrence_bin", relationshipId: relationship.id, deadline: "2026-08-30T00:00:00Z" });
  engine.commands.logAction({ id: "log_bin", actionId: fixture.action.id, eventAt: "2026-08-27T12:00:00Z", quantity: 8, contextRefs: [{ occurrenceId: occurrence.id }] });

  const before = clone(repository.getState());
  assert.throws(() => engine.commands.moveDefinitionsToBin([{ type: "action", id: fixture.action.id }]), /live definitions/);
  assert.deepEqual(repository.getState(), before);

  engine.commands.moveDefinitionsToBin([{ type: "action", id: fixture.action.id }], { removeLiveRelationships: true });
  assert.equal(repository.getState().actions.some((item) => item.id === fixture.action.id), false);
  assert.equal(repository.getState().blocks[0].relationships.length, 0);
  assert.equal(repository.getState().bin[0].id, fixture.action.id);
  assert.equal(repository.getState().actionLogs[0].actionSnapshot.name, "Bench Press");
  assert.equal(engine.queries.getDefinitionImpact("action", fixture.action.id).historicalReferenceCount, 2);

  engine.commands.restoreDefinitions([{ type: "action", id: fixture.action.id }]);
  assert.equal(repository.getState().actions.find((item) => item.id === fixture.action.id).id, fixture.action.id);

  engine.commands.moveDefinitionsToBin([{ type: "action", id: fixture.action.id }], { removeLiveRelationships: true });
  engine.commands.moveDefinitionsToBin([{ type: "tag", id: fixture.actionTag.id }], { removeLiveRelationships: true });
  assert.throws(() => engine.commands.restoreDefinitions([{ type: "action", id: fixture.action.id }]), /missing dependencies/);
  engine.commands.restoreDefinitions([{ type: "action", id: fixture.action.id }], { restoreDependencies: true });
  assert.ok(repository.getState().tags.some((item) => item.id === fixture.actionTag.id));
  assert.ok(repository.getState().actions.some((item) => item.id === fixture.action.id));

  engine.commands.moveDefinitionsToBin([{ type: "action", id: fixture.action.id }], { removeLiveRelationships: true });
  engine.commands.permanentlyDeleteDefinitions([{ type: "action", id: fixture.action.id }], { fromBin: true });
  assert.equal(repository.getState().actions.some((item) => item.id === fixture.action.id), false);
  assert.equal(repository.getState().actionLogs.length, 1);
  assert.equal(repository.getState().tombstones.some((item) => item.objectId === fixture.action.id), true);
  assert.equal(validatePackage(repository.getState()).ok, true);
});

test("Category deletion is blocked without silently deleting Tags or Actions", () => {
  const { engine, repository } = makeEngine();
  const fixture = addActionFixture(engine);
  const before = clone(repository.getState());
  assert.throws(() => engine.commands.moveDefinitionsToBin([{ type: "category", id: fixture.category.id }]), /dependent Tags/);
  assert.deepEqual(repository.getState(), before);
  assert.ok(repository.getState().actions.some((item) => item.id === fixture.action.id));
  assert.ok(repository.getState().tags.some((item) => item.id === fixture.actionTag.id));
});

test("Bulk Block removal preserves selected parent relationships for restore", () => {
  const { engine, repository } = makeEngine();
  const child = engine.commands.createBlock({ id: "block_child", type: "routine", name: "Child Routine" });
  const parent = engine.commands.createBlock({ id: "block_parent", type: "collection", name: "Parent Collection" });
  engine.commands.addRelationship(parent.id, { id: "relationship_child", kind: "block", refId: child.id });

  engine.commands.moveDefinitionsToBin([
    { type: "block", id: child.id },
    { type: "block", id: parent.id }
  ], { removeLiveRelationships: true });

  const parentBinEntry = repository.getState().bin.find((entry) => entry.id === parent.id);
  assert.equal(parentBinEntry.snapshot.relationships[0].refId, child.id);
  engine.commands.restoreDefinitions([
    { type: "block", id: child.id },
    { type: "block", id: parent.id }
  ]);
  assert.equal(repository.getState().blocks.find((block) => block.id === parent.id).relationships[0].refId, child.id);
  assert.equal(validatePackage(repository.getState()).ok, true);
});

test("Historical Result Values retain meaning when a Unit is permanently deleted", () => {
  const { engine, repository } = makeEngine();
  const fixture = addActionFixture(engine, { withResult: true });
  engine.commands.logAction({ id: "log_unit", actionId: fixture.action.id, eventAt: "2026-08-27T12:00:00Z", durationMinutes: 1, resultValues: [{ fieldId: fixture.field.id, value: { value: 60, unitId: fixture.unit.id } }] });
  const impact = engine.queries.getDefinitionImpact("unit", fixture.unit.id);
  assert.equal(impact.historicalReferenceCount, 1);
  engine.commands.moveDefinitionsToBin([{ type: "unit", id: fixture.unit.id }], { removeLiveRelationships: true });
  assert.equal(repository.getState().actionLogs[0].resultValues[0].snapshot.unitSymbol, "tkg");
  engine.commands.permanentlyDeleteDefinitions([{ type: "unit", id: fixture.unit.id }], { fromBin: true });
  assert.equal(repository.getState().tombstones.some((item) => item.objectId === fixture.unit.id), true);
  assert.equal(validatePackage(repository.getState()).ok, true);
});

test("Reusable packages include dependencies and import atomically with undo", () => {
  const source = makeEngine().engine;
  const fixture = addActionFixture(source);
  const block = source.commands.createBlock({ id: "block_package", type: "routine", name: "Package Routine" });
  source.commands.addRelationship(block.id, { id: "relationship_package", kind: "action", refId: fixture.action.id });
  const actionPackage = exportActionPackage(source.getState(), fixture.action.id, { exportedAt: new Date("2026-08-29T01:43:00Z") });
  const blockPackage = exportBlockPackage(source.getState(), block.id, { exportedAt: new Date("2026-08-29T01:43:00Z") });
  assert.deepEqual(packageCounts(actionPackage), { categories: 1, tags: 1, units: 0, actions: 1 });
  assert.equal(blockPackage.rootObjectIds[0], block.id);
  assert.equal(blockPackage.data.blocks.length, 1);
  assert.equal(validatePackage(exportPackage(source.getState()).state).ok, true);

  const target = makeEngine().engine;
  const preview = target.queries.previewImport(actionPackage);
  assert.equal(preview.summary.packageType, "action-package");
  assert.equal(preview.summary.counts.actions, 1);
  assert.equal(target.getState().actions.length, 0);
  target.commands.importPackage(actionPackage);
  assert.equal(target.getState().actions.some((item) => item.id === fixture.action.id), true);
  assert.equal(target.getState().importHistory.length, 1);
  assert.ok(target.getState().meta.restorePoints.some((point) => /import/i.test(point.reason)));
  target.commands.restoreLastImport();
  assert.equal(target.getState().actions.length, 0);

  const unchanged = clone(target.getState());
  assert.throws(() => target.commands.importPackage({ package: "SAMT", schemaVersion: "3.0.0", state: { schemaVersion: "3.0.0" } }), /missing categories/);
  assert.deepEqual(target.getState(), unchanged);
  assert.throws(() => previewImport({ format: "life-command", schemaVersion: 2, packageType: "action-package", packageId: "bad", exportedAt: "2026-01-01T00:00:00Z", rootObjectIds: ["missing"], data: { actions: [] } }, { existingState: target.getState() }), /root is missing/);
});

test("Clear Data is selective and Clear Everything returns a valid empty state", () => {
  const { engine, repository } = makeEngine();
  const action = engine.commands.createAction({ id: "action_clear", name: "Clearable" });
  engine.commands.logAction({ id: "log_clear", actionId: action.id, eventAt: "2026-08-27T12:00:00Z", durationMinutes: 10 });
  const historyBefore = repository.getState().history.length;
  const impact = engine.queries.previewClearData({ categories: ["actionLogs"], dateFilter: "before", before: "2026-08-28" });
  assert.equal(impact.actionLogs, 1);
  const cleared = engine.commands.clearData({ categories: ["actionLogs"], dateFilter: "before", before: "2026-08-28" });
  assert.equal(cleared.actionLogs, 1);
  assert.equal(repository.getState().actionLogs.length, 0);
  assert.ok(repository.getState().history.length > historyBefore);
  assert.ok(repository.getState().meta.restorePoints.length > 0);

  engine.commands.clearEverything();
  const empty = repository.getState();
  assert.equal(empty.categories.length, 0);
  assert.equal(empty.tags.length, 0);
  assert.equal(empty.actions.length, 0);
  assert.equal(empty.blocks.length, 0);
  assert.equal(empty.actionLogs.length, 0);
  assert.equal(empty.history.length, 0);
  assert.equal(empty.units.length, BUILTIN_UNITS.length);
  assert.equal(validatePackage(empty).ok, true);
  assert.ok(empty.meta.restorePoints.length > 0);
  assert.doesNotThrow(() => engine.reconcile());
});

test("Activation cleanup is selectable and preserves run context snapshots", () => {
  const { engine, repository } = makeEngine();
  const block = engine.commands.createBlock({ id: "block_activation", type: "routine", name: "Activation Routine" });
  const activation = engine.commands.createActivation({ id: "activation_clear", blockId: block.id });
  const run = engine.commands.startRun({ id: "run_activation", blockId: block.id });
  repository.getState().runs[0].activationId = activation.id;

  assert.equal(engine.queries.getDataManagerRecords({ type: "activation" }).records[0].selectable, true);
  assert.equal(engine.queries.previewClearData({ categories: ["activations"] }).activations, 1);
  engine.commands.clearData({ categories: ["activations"] });
  assert.equal(repository.getState().activations.length, 0);
  assert.equal(repository.getState().runs.find((item) => item.id === run.id).activationId, null);
  assert.equal(repository.getState().runs[0].activationSnapshot.id, activation.id);
});

test("Settings renders separated V3 sections and operational management controls", () => {
  const { engine } = makeEngine();
  const state = { ...engine.getState(), __storageAvailable: true };
  const html = renderSettingsView({ state, section: "data-storage" });
  assert.match(html, /Data Manager/);
  assert.match(html, /Select All Shown/);
  assert.match(html, /Permanent Delete Selected/);
  assert.match(html, /Before/);
  assert.match(html, /Clear Data/);
  assert.match(html, /Restore Points/);
  assert.match(renderSettingsView({ state, section: "build" }), /Collection · Action List · Routine · Workflow · Project · Cycle · Target/);
  assert.match(renderSettingsView({ state, section: "import-export" }), /Download Full Backup/);
});
