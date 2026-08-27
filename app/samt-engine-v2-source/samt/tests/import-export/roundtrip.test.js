import test from "node:test";
import assert from "node:assert/strict";
import { exportBlockPackage, exportFullBackup } from "../../js/import-export/exporter.js";
import { prepareImport } from "../../js/import-export/importer.js";
import { validatePackage, validateState } from "../../js/import-export/validator.js";
import { stateAt, action, block, relationship } from "../helpers.js";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { deterministicIds } from "../helpers.js";

test("Target Block package round trip preserves semantics", () => {
  const source = stateAt();
  source.actions.push(action("a_study", "Study Action"));
  source.blocks.push(block("b_study", "Study", "target", [relationship("r_study", "action", "a_study")], { targetMetric: "time", targetValue: 360, targetUnit: "minutes", period: { mode: "week" }, aggregation: "inclusive_unique", requireChildTargets: false, requiredChildBlockIds: [] }));
  const pkg = exportBlockPackage(source, ["b_study"], { id: "package_one", now: "2026-08-24T10:00:00.000Z" });
  assert.equal(validatePackage(pkg).ok, true);
  const empty = stateAt();
  const preview = prepareImport(empty, pkg);
  validateState(preview.candidate);
  assert.deepEqual(preview.candidate.blocks[0].typeConfig, source.blocks[0].typeConfig);
});

test("Full Backup retains complete factual state", () => {
  const source = stateAt();
  source.actions.push(action("a_one", "One"));
  source.actionLogs.push({ id: "log_one", actionId: "a_one", actionNameSnapshot: "One", timestamp: "2026-08-24T10:00:00.000Z", durationPerformed: 30 });
  const pkg = exportFullBackup(source, { id: "backup_one", now: "2026-08-24T11:00:00.000Z" });
  const preview = prepareImport(stateAt(), pkg);
  assert.equal(preview.candidate.actionLogs[0].id, "log_one");
  assert.equal(preview.candidate.actions[0].id, "a_one");
});

test("same-name dependencies map to existing stable IDs", () => {
  const source = stateAt();
  source.categories.push({ id: "category_in", name: "Learning", status: "active" });
  source.tags.push({ id: "tag_in", name: "Language", categoryId: "category_in", status: "active" });
  source.units.push({ id: "unit_in", name: "Minutes", symbol: "min", status: "active" });
  source.actions.push({ ...action("action_in", "Study Session"), tagIds: ["tag_in"], result: { mode: "measurement", unitId: "unit_in", allowedUnitIds: ["unit_in"] } });
  source.blocks.push(block("block_in", "Study Programme", "collection", [relationship("rel_action", "action", "action_in")]));
  const pkg = exportBlockPackage(source, ["block_in"], { id: "package_mapping", now: "2026-08-24T11:00:00.000Z" });

  const local = stateAt();
  local.categories.push({ id: "category_local", name: "Learning", status: "active" });
  local.tags.push({ id: "tag_local", name: "Language", categoryId: "category_local", status: "active" });
  local.units.push({ id: "unit_local", name: "Minutes", symbol: "min", status: "active" });
  const preview = prepareImport(local, pkg);
  const importedAction = preview.candidate.actions.find((item) => item.id === "action_in");
  assert.deepEqual(importedAction.tagIds, ["tag_local"]);
  assert.equal(importedAction.result.unitId, "unit_local");
  assert.deepEqual(importedAction.result.allowedUnitIds, ["unit_local"]);
});

test("same-name imported Action is reused by imported Block", () => {
  const source = stateAt();
  source.actions.push(action("incoming_action", "Shared Study"));
  source.blocks.push(block("incoming_block", "Imported Plan", "collection", [relationship("incoming_rel", "action", "incoming_action")]));
  const pkg = exportBlockPackage(source, ["incoming_block"], { id: "package_reuse", now: "2026-08-24T11:00:00.000Z" });
  const local = stateAt();
  local.actions.push(action("local_action", "Shared Study"));
  const preview = prepareImport(local, pkg);
  assert.equal(preview.candidate.actions.length, 1);
  assert.equal(preview.candidate.blocks[0].children[0].refId, "local_action");
});

test("schema v1 package migrates explicitly to v2", () => {
  const legacy = {
    format: "life-command", schemaVersion: 1, packageId: "legacy_package", packageType: "action-package", exportedAt: "2026-08-24T11:00:00.000Z",
    data: { categories: [], tags: [], units: [], actions: [action("legacy_action", "Legacy Action")], blocks: [], activationPresets: [], styles: [] }
  };
  const preview = prepareImport(stateAt(), legacy);
  assert.equal(preview.package.schemaVersion, 2);
  assert.deepEqual(preview.package.rootObjectIds, []);
  assert.equal(preview.candidate.actions[0].id, "legacy_action");
});

test("commit rebuilds the candidate from a validated package and ignores a mutated preview candidate", async () => {
  const source = stateAt();
  source.actions.push(action("safe_action", "Safe Action"));
  const pkg = exportBlockPackage({ ...source, blocks: [block("safe_block", "Safe Block", "collection", [relationship("safe_rel", "action", "safe_action")])] }, ["safe_block"], { id: "safe_package", now: "2026-08-24T11:00:00.000Z" });
  const repository = new MemoryRepository(stateAt());
  const engine = new SamtEngine({ repository, clock: new FakeClock("2026-08-24T12:00:00.000Z"), idFactory: deterministicIds() });
  await engine.initialize();
  const preview = engine.prepareImport(pkg);
  preview.candidate.actions[0].name = "Injected Mutation";
  preview.plan[0].resolution = "replace_existing";
  await engine.commitImport(preview);
  assert.equal(engine.queries.getActionById("safe_action").name, "Safe Action");
});

test("Undo Import restores the exact pre-import state", async () => {
  const local = stateAt();
  local.actions.push(action("local_action", "Local Action"));
  const source = stateAt();
  source.actions.push(action("incoming_action", "Incoming Action"));
  const pkg = exportFullBackup(source, { id: "backup_exact", now: "2026-08-24T11:00:00.000Z" });
  const repository = new MemoryRepository(local);
  const engine = new SamtEngine({ repository, clock: new FakeClock("2026-08-24T12:00:00.000Z"), idFactory: deterministicIds() });
  await engine.initialize();
  const before = engine.queries.getState();
  const committed = await engine.commitImport(engine.prepareImport(pkg));
  assert.equal(engine.queries.getActionById("incoming_action").name, "Incoming Action");
  await engine.undoImport(committed.value.restorePointId);
  assert.deepEqual(engine.queries.getState(), before);
});

test("package validation rejects duplicate IDs and missing roots before import", () => {
  const source = stateAt();
  source.actions.push(action("duplicate", "Duplicate"));
  const pkg = {
    format: "life-command", schemaVersion: 2, packageId: "invalid_package", packageType: "action-package", exportedAt: "2026-08-24T11:00:00.000Z", rootObjectIds: ["missing"],
    data: { categories: [], tags: [], units: [], actions: [source.actions[0], { ...source.actions[0], name: "Second" }], blocks: [], activationPresets: [], styles: [] }
  };
  assert.throws(() => validatePackage(pkg), /duplicate stable ID/);
  pkg.data.actions.pop();
  assert.throws(() => validatePackage(pkg), /root is missing/);
});
